import { google } from 'googleapis'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/lib/supabase'
import { embedText } from '@/lib/embeddings'

// Google OAuth client configuration
export function createOAuthClient() {
  return new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!
  })
}

// Create authenticated Google Drive client
export function createDriveClient(tokens: any) {
  const auth = createOAuthClient()
  auth.setCredentials(tokens)
  return google.drive({ version: 'v3', auth })
}

// Create authenticated Google Docs client
export function createDocsClient(tokens: any) {
  const auth = createOAuthClient()
  auth.setCredentials(tokens)
  return google.docs({ version: 'v1', auth })
}

// Extract file ID from Google Docs URL
export function extractFileIdFromUrl(url: string): string | null {
  const patterns = [
    /\/document\/d\/([a-zA-Z0-9-_]+)/,
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /\/presentation\/d\/([a-zA-Z0-9-_]+)/,
    /\/file\/d\/([a-zA-Z0-9-_]+)/
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  
  return null
}

// Structure-aware chunking types
export interface FlatBlock {
  text: string
  headingLevel: number // 0 for body
  headingPath: string[] // e.g., ["Intro", "Motivation"]
}

export interface Chunk {
  text: string
  headingPath: string[]
  metadata: Record<string, any>
}

// Flatten Google Docs document into structured blocks
export function flattenDoc(doc: any): FlatBlock[] {
  const out: FlatBlock[] = []
  const path: string[] = []
  
  for (const el of doc.body?.content ?? []) {
    if (!el.paragraph) continue
    
    const style = el.paragraph.paragraphStyle
    const text = (el.paragraph.elements ?? [])
      .map((e: any) => e.textRun?.content ?? "")
      .join("")
    
    if (!text.trim()) continue

    const hl = headingLevel(style?.namedStyleType)
    if (hl > 0) {
      // Update path to depth hl
      path.splice(hl - 1)
      const title = text.trim().replace(/\n+$/, "")
      path[hl - 1] = title
      continue // Headings themselves are not content blocks
    }
    
    out.push({
      text,
      headingLevel: path.length,
      headingPath: [...path],
    })
  }
  
  return out
}

// Get heading level from Google Docs named style
function headingLevel(named?: string): number {
  // HEADING_1..HEADING_6 → 1..6, else 0
  return named?.startsWith("HEADING_") ? Number(named.split("_")[1]) : 0
}

// Chunk blocks with structure awareness
export function chunkBlocks(blocks: FlatBlock[], maxTokens = 1100, overlap = 0.1): Chunk[] {
  const chunks: Chunk[] = []
  let buf: FlatBlock[] = []
  let cur = 0
  const max = maxTokens
  const overlapChars = Math.floor(max * 4 * overlap) // Rough token estimation

  for (const b of blocks) {
    const t = b.text
    const est = Math.ceil(t.length / 4) // Rough token estimation
    
    if (cur + est > max && buf.length) {
      const txt = buf.map(x => x.text).join("\n")
      chunks.push({ 
        text: txt, 
        headingPath: buf[0].headingPath,
        metadata: {
          heading_level: buf[0].headingLevel,
          chunk_size: txt.length
        }
      })
      
      // Create overlap
      const overlapText = txt.slice(-overlapChars)
      buf = [{ 
        text: overlapText, 
        headingLevel: 0, 
        headingPath: buf[0].headingPath 
      }]
      cur = Math.ceil(overlapText.length / 4)
    }
    
    buf.push(b)
    cur += est
  }
  
  if (buf.length) {
    chunks.push({ 
      text: buf.map(x => x.text).join("\n"), 
      headingPath: buf[0].headingPath,
      metadata: {
        heading_level: buf[0].headingLevel,
        chunk_size: buf.map(x => x.text).join("\n").length
      }
    })
  }
  
  return chunks
}

// Get file metadata and permissions
export async function getFileMetadata(fileId: string, tokens: any) {
  const drive = createDriveClient(tokens)
  
  // Get file metadata
  const file = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, modifiedTime, headRevisionId, webViewLink',
    supportsAllDrives: true
  })

  // Get permissions
  const perms = await drive.permissions.list({
    fileId,
    fields: 'permissions(emailAddress,domain,role,type)',
    supportsAllDrives: true
  })

  // Create permissions hash
  const permissionsHash = createPermissionsHash(perms.data.permissions || [])

  return {
    file: file.data,
    permissions: perms.data.permissions || [],
    permissionsHash
  }
}

// Create stable hash of permissions
function createPermissionsHash(permissions: any[]): string {
  const sorted = permissions
    .map(p => `${p.type}:${p.role}:${p.emailAddress || p.domain || 'anyone'}`)
    .sort()
  
  return Buffer.from(sorted.join('|')).toString('base64')
}

// Store Google account tokens
export async function storeGoogleTokens(
  userId: string, 
  googleUserId: string, 
  email: string, 
  tokens: any
) {
  const { data, error } = await supabase
    .from('google_accounts')
    .upsert({
      user_id: userId,
      google_user_id: googleUserId,
      email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: new Date(tokens.expiry_date).toISOString()
    })

  if (error) throw error
  return data
}

// Get Google account tokens
export async function getGoogleTokens(userId: string) {
  const { data, error } = await supabase
    .from('google_accounts')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

// Refresh Google tokens if needed
export async function refreshTokensIfNeeded(tokens: any) {
  const auth = createOAuthClient()
  auth.setCredentials(tokens)
  
  try {
    const { credentials } = await auth.refreshAccessToken()
    return credentials
  } catch (error) {
    console.error('Token refresh failed:', error)
    throw error
  }
}

// Store Google Docs source
export async function storeGoogleDocSource(
  spaceId: string,
  googleFileId: string,
  title: string,
  mimeType: string,
  latestRevisionId: string,
  modifiedTime: string,
  permissionsHash: string,
  addedBy: string
) {
  const { data, error } = await supabase
    .from('sources_google_docs')
    .insert({
      space_id: spaceId,
      google_file_id: googleFileId,
      google_doc_id: googleFileId,
      title,
      mime_type: mimeType,
      latest_revision_id: latestRevisionId,
      modified_time: modifiedTime,
      permissions_hash: permissionsHash,
      added_by: addedBy
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Store Google Docs chunks with embeddings
export async function storeGoogleDocChunks(
  spaceId: string,
  sourceId: string,
  chunks: Chunk[]
) {
  // Generate embeddings for all chunks
  const chunksWithEmbeddings = await Promise.all(
    chunks.map(async (chunk, index) => {
      const embedding = await embedText(chunk.text)
      return {
        space_id: spaceId,
        source_id: sourceId,
        heading_path: chunk.headingPath,
        text: chunk.text,
        metadata: chunk.metadata,
        embedding: embedding,
        chunk_index: index
      }
    })
  )

  const { data, error } = await supabase
    .from('google_doc_chunks')
    .insert(chunksWithEmbeddings)

  if (error) throw error
  return data
}

// Delete chunks for a source (for re-indexing)
export async function deleteChunksForSource(sourceId: string) {
  const { error } = await supabase
    .from('google_doc_chunks')
    .delete()
    .eq('source_id', sourceId)

  if (error) throw error
}

// Create Google Drive watch
export async function createDriveWatch(fileId: string, tokens: any) {
  const drive = createDriveClient(tokens)
  const channelId = uuidv4()
  
  const watch = await drive.files.watch({
    fileId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/google/drive`
    }
  })

  return {
    channelId: watch.data.id,
    resourceId: watch.data.resourceId,
    expiresAt: new Date(watch.data.expiration!)
  }
}

// Store drive watch
export async function storeDriveWatch(
  googleFileId: string,
  channelId: string,
  resourceId: string,
  expiresAt: Date
) {
  const { data, error } = await supabase
    .from('gdrive_watches')
    .insert({
      google_file_id: googleFileId,
      channel_id: channelId,
      resource_id: resourceId,
      expires_at: expiresAt.toISOString()
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Get drive watch by channel ID
export async function getDriveWatchByChannel(channelId: string) {
  const { data, error } = await supabase
    .from('gdrive_watches')
    .select('*')
    .eq('channel_id', channelId)
    .single()

  if (error) throw error
  return data
}

// Stop drive watch
export async function stopDriveWatch(channelId: string, resourceId: string, tokens: any) {
  const drive = createDriveClient(tokens)
  
  await drive.channels.stop({
    requestBody: {
      id: channelId,
      resourceId
    }
  })
}

// Delete drive watch from database
export async function deleteDriveWatch(channelId: string) {
  const { error } = await supabase
    .from('gdrive_watches')
    .delete()
    .eq('channel_id', channelId)

  if (error) throw error
}
