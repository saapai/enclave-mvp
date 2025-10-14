import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase, supabaseAdmin } from '@/lib/supabase'
import { upsertResourceEmbedding, upsertResourceChunks } from '@/lib/embeddings'
import { validateResourceTitle, validateResourceDescription, validateTags, validateUrl, sanitizeInput } from '@/lib/security'
import { apiCache, CACHE_KEYS } from '@/lib/cache'

// Storage bucket used for uploaded files
const STORAGE_BUCKET = 'resources'
const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

async function ensureBucketExists(): Promise<void> {
  // If we don't have admin client, assume bucket already exists and is public
  if (!supabaseAdmin) return

  try {
    const { data: list, error: listError } = await supabaseAdmin.storage.listBuckets()
    if (listError) {
      // If listing buckets fails, attempt to create directly
      await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
        public: true
      })
      return
    }
    const exists = list?.some((b) => b.name === STORAGE_BUCKET)
    if (!exists) {
      await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
        public: true
      })
    }
  } catch (_e) {
    // Non-fatal; uploading may still work if bucket already exists
  }
}

async function extractTextFromFile(file: File): Promise<string | null> {
  try {
    const contentType = file.type || ''
    const lowerName = file.name.toLowerCase()

    // Text-like files
    if (contentType.startsWith('text/') || contentType.includes('markdown') || /\.(txt|md|csv|json|html?)$/i.test(lowerName)) {
      const text = await file.text()
      // Handle subtypes specifically
      if (lowerName.endsWith('.html') || lowerName.endsWith('.htm') || contentType.includes('text/html')) {
        try {
          const { htmlToText } = await import('html-to-text')
          return htmlToText(text, { wordwrap: 120, selectors: [{ selector: 'a', options: { ignoreHref: true } }] })
        } catch {
          return text
        }
      }
      if (lowerName.endsWith('.csv') || contentType.includes('text/csv')) {
        try {
          const { parse } = await import('csv-parse/sync')
          const rows: string[][] = parse(text)
          return rows.map((row) => row.join(', ')).join('\n')
        } catch {
          return text
        }
      }
      if (lowerName.endsWith('.json') || contentType.includes('application/json')) {
        try {
          const obj = JSON.parse(text)
          return JSON.stringify(obj, null, 2)
        } catch {
          return text
        }
      }
      // Default for .txt/.md and other text types
      return text
    }

    // PDFs via dynamic import to avoid bundling issues if not installed
    if (contentType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse')).default as (data: Buffer) => Promise<{ text: string }>
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const result = await pdfParse(buffer)
        return result.text || null
      } catch (_err) {
        // pdf-parse not installed or failed; skip extraction
        return null
      }
    }

    // DOCX via mammoth
    if (lowerName.endsWith('.docx') || contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
      try {
        const mammoth = await import('mammoth')
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const result = await (mammoth as any).extractRawText({ buffer })
        let text = (result?.value as string) || ''

        // Skip OCR on embedded images for now to avoid Tesseract issues
        // TODO: Re-enable OCR when Tesseract is properly configured

        return text || null
      } catch {
        return null
      }
    }

    // XLSX via xlsx
    if (lowerName.endsWith('.xlsx') || contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
      try {
        const XLSX = await import('xlsx')
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const workbook = (XLSX as any).read(buffer, { type: 'buffer' })
        const pieces: string[] = []
        for (const sheetName of workbook.SheetNames as string[]) {
          const sheet = workbook.Sheets[sheetName]
          const csv = (XLSX as any).utils.sheet_to_csv(sheet)
          pieces.push(`# ${sheetName}\n${csv}`)
        }
        return pieces.join('\n\n')
      } catch {
        return null
      }
    }

    // Standalone image files -> Skip OCR for now to avoid Tesseract issues
    if (contentType.startsWith('image/') || /\.(png|jpg|jpeg|gif|bmp|webp|tif|tiff)$/i.test(lowerName)) {
      // TODO: Re-enable OCR when Tesseract is properly configured
      return null
    }

    // Unsupported types -> no extraction
    return null
  } catch (_error) {
    return null
  }
}

// OCR function disabled to avoid Tesseract module issues
// async function ocrBuffers(buffers: Buffer[]): Promise<string> {
//   try {
//     const { createWorker } = await import('tesseract.js')
//     const worker = await createWorker('eng')
//     const results: string[] = []
//     for (const buf of buffers) {
//       const { data } = await worker.recognize(buf as unknown as ArrayBuffer)
//       if (data?.text) results.push(data.text)
//     }
//     await worker.terminate()
//     return results.join('\n').trim()
//   } catch (_e) {
//     return ''
//   }
// }


export async function POST(request: NextRequest) {
  try {
    console.log('Upload API called')
    const { userId } = await auth()
    console.log('User ID:', userId)
    const isDev = process.env.NODE_ENV !== 'production'
    if (!userId && !isDev) {
      console.log('Unauthorized access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const form = await request.formData()
    const file = form.get('file') as File | null

    const title = (form.get('title') as string | null)?.trim() || ''
    const description = (form.get('description') as string | null)?.trim() || ''
    const type = (form.get('type') as string | null)?.trim() || 'doc'
    const url = (form.get('url') as string | null)?.trim() || ''
    const tagsRaw = (form.get('tags') as string | null) || '[]'
    const spaceIdsRaw = (form.get('spaceIds') as string | null) || `["${DEFAULT_SPACE_ID}"]`
    const startAt = (form.get('startAt') as string | null) || ''
    const endAt = (form.get('endAt') as string | null) || ''

    console.log('Form data received:', { title, description, type, url, tagsRaw, hasFile: !!file })

    // Validate inputs
    const titleValidation = validateResourceTitle(title)
    if (!titleValidation.valid) {
      return NextResponse.json({ error: titleValidation.error }, { status: 400 })
    }

    const descriptionValidation = validateResourceDescription(description)
    if (!descriptionValidation.valid) {
      return NextResponse.json({ error: descriptionValidation.error }, { status: 400 })
    }

    if (url && !validateUrl(url)) {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }

    let tags: string[] = []
    try {
      tags = JSON.parse(tagsRaw)
    } catch {
      return NextResponse.json({ error: 'Invalid tags format' }, { status: 400 })
    }

    let spaceIds: string[] = []
    try {
      spaceIds = JSON.parse(spaceIdsRaw)
    } catch {
      return NextResponse.json({ error: 'Invalid space IDs format' }, { status: 400 })
    }

    const tagsValidation = validateTags(tags)
    if (!tagsValidation.valid) {
      return NextResponse.json({ error: tagsValidation.error }, { status: 400 })
    }

    // Sanitize inputs
    const sanitizedTitle = sanitizeInput(title)
    const sanitizedDescription = sanitizeInput(description)
    const sanitizedUrl = url ? sanitizeInput(url) : ''
    const sanitizedTags = tags.map(tag => sanitizeInput(tag))
    const location = (form.get('location') as string | null) || ''
    const rsvpLink = (form.get('rsvpLink') as string | null) || ''
    const cost = (form.get('cost') as string | null) || ''
    const dressCode = (form.get('dressCode') as string | null) || ''

    if (!title && !file) {
      console.log('Validation failed: Title or file is required')
      return NextResponse.json({ error: 'Title or file is required' }, { status: 400 })
    }

    // Attempt text extraction if file provided
    let extractedText: string | null = null
    if (file) {
      extractedText = await extractTextFromFile(file)
    }


    // Insert resources for each selected space
    console.log('Inserting resources into database for spaces:', spaceIds)
    const insertedResources = []
    
    // Use admin client to bypass RLS (auth is validated at route level with Clerk)
    const dbClient = supabaseAdmin || supabase
    
    for (const spaceId of spaceIds) {
      const { data: inserted, error: insertError } = await dbClient
        .from('resource')
        .insert({
          space_id: spaceId,
          type: (['event', 'doc', 'form', 'link', 'faq'] as const).includes(type as any) ? type : 'doc',
          title: sanitizedTitle || (file ? file.name : 'Untitled'),
          body: extractedText || sanitizedDescription || null,
          url: sanitizedUrl || null,
          source: 'upload',
          visibility: 'space',
          created_by: userId || null as any
        } as any)
        .select()
        .single()

      if (insertError) {
        console.error('Database insert error for space', spaceId, ':', insertError)
        throw insertError
      }
      
      insertedResources.push(inserted)
      console.log('Resource inserted successfully for space', spaceId, ':', inserted)
    }

    // Use the first resource ID for file upload and other operations
    const primaryResourceId = (insertedResources[0] as any).id as string

    // Upload file to storage and update resource URLs for all resources
    if (file) {
      await ensureBucketExists()

      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const ext = file.name.split('.').pop() || 'bin'
      
      // Upload file once and get public URL
      const objectPath = `${DEFAULT_SPACE_ID}/${primaryResourceId}/${Date.now()}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(objectPath, buffer, {
          contentType: file.type || 'application/octet-stream',
          upsert: true
        })

      if (!uploadError) {
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath)
        const publicUrl = pub?.publicUrl || null
        if (publicUrl) {
          // Update URL for all resources
          for (const resource of insertedResources) {
            await dbClient
              .from('resource')
              .update({ url: publicUrl })
              .eq('id', (resource as any).id)
          }
        }
      }
    }

    // Handle tags for all resources
    if (sanitizedTags.length > 0) {
      for (const resource of insertedResources) {
        const resourceId = (resource as any).id
        const spaceId = (resource as any).space_id
        
        for (const tagName of sanitizedTags) {
          const { data: existingTag } = await supabase
            .from('tag')
            .select('id')
            .eq('space_id', spaceId)
            .eq('name', tagName)
            .single()
          let tagId = (existingTag as any)?.id as string | undefined
          if (!tagId) {
            const { data: newTag } = await supabase
              .from('tag')
              .insert({
                space_id: spaceId,
                name: tagName,
                kind: 'topic'
              } as any)
              .select()
              .single()
            tagId = (newTag as any)?.id
          }
          if (tagId) {
            await supabase
              .from('resource_tag')
              .insert({ resource_id: resourceId, tag_id: tagId } as any)
          }
        }
      }
    }

    // Event metadata for all resources
    if (type === 'event' && (startAt || endAt || location || rsvpLink || cost || dressCode)) {
      for (const resource of insertedResources) {
        await supabase
          .from('event_meta')
          .insert({
            resource_id: (resource as any).id,
            start_at: startAt || null,
            end_at: endAt || null,
            location: location || null,
            rsvp_link: rsvpLink || null,
            cost: cost || null,
            dress_code: dressCode || null
          } as any)
      }
    }

    // Compute embedding and chunks asynchronously (best-effort). Skip if tables are missing.
    try {
      const { error: vecCheckError } = await supabase
        .from('resource_embedding' as any)
        .select('resource_id')
        .limit(0)
      if (!vecCheckError) {
        const textForEmbed = [inserted.title, extractedText || description].filter(Boolean).join('\n\n')
        if (textForEmbed) {
          await upsertResourceEmbedding(resourceId, textForEmbed)
        }
      }
      // Chunks
      const { error: chunkCheckError } = await supabase
        .from('resource_chunk' as any)
        .select('id')
        .limit(0)
      if (!chunkCheckError) {
        const textForChunks = extractedText || description || ''
        if (textForChunks) {
          await upsertResourceChunks(resourceId, textForChunks)
        }
      }
    } catch (_e) { /* ignore embedding failures */ }

    // Return the first created resource including tags and event_meta
    const { data: resource, error: fetchError } = await dbClient
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*)
      `)
      .eq('id', primaryResourceId)
      .single()

    if (fetchError) throw fetchError

    const transformed = resource
      ? {
          ...resource,
          tags: (resource.tags as Array<{ tag: Record<string, unknown> }> | null)?.map((rt) => rt.tag).filter(Boolean) || []
        }
      : resource

    // Clear cache after successful upload
    apiCache.delete(CACHE_KEYS.RESOURCES)

    return NextResponse.json({ resource: transformed })
  } catch (error) {
    console.error('Upload ingestion error:', error)
    return NextResponse.json({ error: 'Failed to upload and ingest file' }, { status: 500 })
  }
}


