import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { 
  getGoogleTokens, 
  refreshTokensIfNeeded,
  createDocsClient,
  flattenDoc,
  chunkBlocks,
  storeGoogleDocChunks,
  getFileMetadata
} from '@/lib/google-docs'
import { supabase } from '@/lib/supabase'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { sourceId } = body

    if (!sourceId) {
      return NextResponse.json({ error: 'Source ID is required' }, { status: 400 })
    }

    console.log('Refreshing Google Doc:', { userId, sourceId })

    // Get the source document
    const { data: source, error: sourceError } = await supabase
      .from('sources_google_docs')
      .select('*')
      .eq('id', sourceId)
      .single()

    if (sourceError || !source) {
      return NextResponse.json({ error: 'Google Doc not found' }, { status: 404 })
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
    let tokens
    try {
      tokens = await refreshTokensIfNeeded({
        access_token: googleAccount.access_token,
        refresh_token: googleAccount.refresh_token,
        expiry_date: new Date(googleAccount.token_expiry).getTime()
      })
    } catch (tokenError) {
      console.error('Token refresh failed:', tokenError)
      return NextResponse.json({ 
        error: 'Google account needs re-authentication',
        needsOAuth: true,
        oauthUrl: `/api/oauth/google/start`,
        details: 'Your Google account session has expired. Please reconnect your Google account.'
      }, { status: 400 })
    }

    // Get file metadata to check if it's been modified
    const { file, permissionsHash } = await getFileMetadata(source.google_file_id, tokens)

    console.log('File metadata:', {
      modifiedTime: file.modifiedTime,
      storedModifiedTime: source.modified_time,
      revisionId: file.headRevisionId,
      storedRevisionId: source.latest_revision_id
    })

    // Check if the document has been modified
    // Use both revision ID and modified time for better detection
    const revisionChanged = file.headRevisionId !== source.latest_revision_id
    const timeChanged = new Date(file.modifiedTime!).getTime() > new Date(source.modified_time).getTime()
    const isModified = revisionChanged || timeChanged

    console.log('Modification check:', {
      revisionChanged,
      timeChanged,
      isModified
    })

    if (!isModified) {
      console.log('Google Doc is already up to date, skipping refresh')
      return NextResponse.json({ 
        success: true,
        message: 'Google Doc is already up to date',
        isModified: false
      })
    }

    console.log('Google Doc has changes, re-indexing...')

    // Fetch updated document content
    const docs = createDocsClient(tokens)
    const doc = await docs.documents.get({ documentId: source.google_file_id })

    // Flatten and chunk the document
    const blocks = flattenDoc(doc.data)
    const chunks = chunkBlocks(blocks)

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'No content found in document' }, { status: 400 })
    }

    // Delete old chunks
    const { error: deleteError } = await supabase
      .from('google_doc_chunks')
      .delete()
      .eq('source_id', sourceId)

    if (deleteError) {
      console.error('Error deleting old chunks:', deleteError)
    }

    // Store new chunks with embeddings
    await storeGoogleDocChunks(DEFAULT_SPACE_ID, sourceId, chunks)

    // Update source metadata
    const { error: updateError } = await supabase
      .from('sources_google_docs')
      .update({
        latest_revision_id: file.headRevisionId,
        modified_time: file.modifiedTime,
        permissions_hash: permissionsHash,
        updated_at: new Date().toISOString()
      })
      .eq('id', sourceId)

    if (updateError) {
      console.error('Error updating source metadata:', updateError)
    }

    // Update the corresponding resource entry
    const { error: resourceUpdateError } = await supabase
      .from('resource')
      .update({
        body: `Live Google Doc - ${chunks.length} sections indexed`,
        updated_at: new Date().toISOString()
      })
      .eq('source', 'gdoc')
      .eq('title', source.title)

    if (resourceUpdateError) {
      console.error('Error updating resource:', resourceUpdateError)
    }

    // CRITICAL: Clear ALL caches to ensure updated content appears in search results
    const { apiCache, CACHE_KEYS } = await import('@/lib/cache')
    apiCache.delete(CACHE_KEYS.RESOURCES)
    
    console.log('Cleared resources cache to refresh search results')

    console.log('Google Doc refreshed successfully:', {
      sourceId,
      chunksCount: chunks.length,
      newRevisionId: file.headRevisionId
    })

    return NextResponse.json({ 
      success: true,
      message: 'Google Doc refreshed successfully',
      isModified: true,
      chunksCount: chunks.length,
      revisionId: file.headRevisionId
    })

  } catch (error) {
    console.error('Google Docs refresh error:', error)
    return NextResponse.json({ 
      error: 'Failed to refresh Google Doc',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

