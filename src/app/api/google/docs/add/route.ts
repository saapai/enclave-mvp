import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { 
  getGoogleTokens, 
  refreshTokensIfNeeded,
  extractFileIdFromUrl,
  getFileMetadata,
  createDocsClient,
  flattenDoc,
  chunkBlocks,
  storeGoogleDocSource,
  storeGoogleDocChunks,
  createDriveWatch,
  storeDriveWatch
} from '@/lib/google-docs'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check rate limit
    const rateLimitResult = checkRateLimit(userId, 'GOOGLE_DOCS')
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: 'Rate limit exceeded', 
          remaining: rateLimitResult.remaining,
          resetTime: rateLimitResult.resetTime
        }, 
        { status: 429 }
      )
    }

    const body = await request.json()
    const { urlOrFileId, spaceId = DEFAULT_SPACE_ID } = body

    logger.debug('Google Docs add request', { userId, urlOrFileId, spaceId })

    if (!urlOrFileId) {
      return NextResponse.json({ error: 'URL or file ID is required' }, { status: 400 })
    }

    // Get user's Google tokens
    const googleAccount = await getGoogleTokens(userId)
    if (!googleAccount) {
      return NextResponse.json({ 
        error: 'Google account not connected',
        needsOAuth: true,
        oauthUrl: `/api/oauth/google/start`
      }, { status: 400 })
    }

    // Refresh tokens if needed
    const tokens = await refreshTokensIfNeeded({
      access_token: googleAccount.access_token,
      refresh_token: googleAccount.refresh_token,
      expiry_date: new Date(googleAccount.token_expiry).getTime()
    })

    // Extract file ID from URL or use provided ID
    const fileId = urlOrFileId.startsWith('http') 
      ? extractFileIdFromUrl(urlOrFileId)
      : urlOrFileId

    if (!fileId) {
      return NextResponse.json({ error: 'Invalid Google Docs URL' }, { status: 400 })
    }

    // Get file metadata and permissions
    const { file, permissionsHash } = await getFileMetadata(fileId, tokens)

    // Check if it's a Google Docs file
    if (!file.mimeType?.includes('document')) {
      return NextResponse.json({ error: 'Only Google Docs files are supported' }, { status: 400 })
    }

    // Fetch document content
    const docs = createDocsClient(tokens)
    const doc = await docs.documents.get({ documentId: fileId })

    // Flatten and chunk the document
    const blocks = flattenDoc(doc.data)
    const chunks = chunkBlocks(blocks)

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'No content found in document' }, { status: 400 })
    }

    // Store the source
    const source = await storeGoogleDocSource(
      spaceId,
      fileId,
      file.name || 'Untitled Document',
      file.mimeType!,
      file.headRevisionId!,
      file.modifiedTime!,
      permissionsHash,
      userId
    )

    // Store chunks with embeddings
    await storeGoogleDocChunks(spaceId, source.id, chunks)

    // Create drive watch for real-time updates
    try {
      const watch = await createDriveWatch(fileId, tokens)
      await storeDriveWatch(fileId, watch.channelId, watch.resourceId, watch.expiresAt)
    } catch (watchError) {
      console.warn('Failed to create drive watch:', watchError)
      // Continue without watch - manual sync will still work
    }

    return NextResponse.json({ 
      success: true, 
      source: {
        id: source.id,
        title: source.title,
        fileId: source.google_file_id,
        chunksCount: chunks.length
      }
    })

  } catch (error: any) {
    console.error('Google Docs add error:', error)
    
    // Check if it's a duplicate key error
    if (error?.code === '23505' && error?.message?.includes('duplicate key')) {
      return NextResponse.json({ 
        error: 'This Google Doc is already connected',
        details: 'The document has already been added to your resources.',
        isAlreadyConnected: true
      }, { status: 409 })
    }
    
    // Return more specific error information
    if (error instanceof Error) {
      return NextResponse.json({ 
        error: 'Failed to add Google Doc',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }, { status: 500 })
    }
    
    return NextResponse.json({ error: 'Failed to add Google Doc' }, { status: 500 })
  }
}
