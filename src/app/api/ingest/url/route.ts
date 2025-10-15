import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

async function fetchAndExtract(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    const buf = Buffer.from(await res.arrayBuffer())

    if (contentType.includes('text/html')) {
      const html = buf.toString('utf-8')
      const { htmlToText } = await import('html-to-text')
      // Primitive title parse
      const titleMatch = html.match(/<title>(.*?)<\/title>/i)
      const title = titleMatch?.[1]?.trim() || url
      const text = htmlToText(html, { wordwrap: 120 })
      return { title, text }
    }

    if (contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
      const { extractText } = await import('unpdf')
      const { text } = await extractText(new Uint8Array(buf), { mergePages: true })
      return { title: url, text: text?.trim() || '' }
    }

    // Fallback: try utf-8
    return { title: url, text: buf.toString('utf-8') }
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { url, tags = [] } = body
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 })

    const extracted = await fetchAndExtract(url)
    if (!extracted) return NextResponse.json({ error: 'Failed to fetch url' }, { status: 500 })

    const { data: resource, error: resourceError } = await supabase
      .from('resource')
      .insert({
        space_id: DEFAULT_SPACE_ID,
        type: 'link',
        title: extracted.title || url,
        body: extracted.text || null,
        url,
        source: 'upload',
        visibility: 'space',
        created_by: userId
      } as any)
      .select()
      .single()

    if (resourceError) throw resourceError

    if (tags.length > 0) {
      for (const tagName of tags) {
        const { data: existingTag } = await supabase
          .from('tag')
          .select('id')
          .eq('space_id', DEFAULT_SPACE_ID)
          .eq('name', tagName)
          .single()
        let tagId = (existingTag as any)?.id as string | undefined
        if (!tagId) {
          const { data: newTag } = await supabase
            .from('tag')
            .insert({ space_id: DEFAULT_SPACE_ID, name: tagName, kind: 'topic' } as any)
            .select()
            .single()
          tagId = (newTag as any)?.id
        }
        if (tagId) {
          await supabase
            .from('resource_tag')
            .insert({ resource_id: (resource as any).id, tag_id: tagId } as any)
        }
      }
    }

    return NextResponse.json({ resource })
  } catch (e) {
    console.error('URL ingest error:', e)
    return NextResponse.json({ error: 'Failed to ingest url' }, { status: 500 })
  }
}


