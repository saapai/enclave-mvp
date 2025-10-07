import { NextRequest, NextResponse } from 'next/server'
import { 
  getDriveWatchByChannel,
  deleteDriveWatch,
  getGoogleTokens,
  refreshTokensIfNeeded,
  getFileMetadata,
  createDocsClient,
  flattenDoc,
  chunkBlocks,
  deleteChunksForSource,
  storeGoogleDocChunks
} from '@/lib/google-docs'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const channelId = request.headers.get('X-Goog-Channel-Id')
    const resourceId = request.headers.get('X-Goog-Resource-Id')
    const state = request.headers.get('X-Goog-Resource-State')

    if (!channelId || !resourceId) {
      return NextResponse.json({ error: 'Missing required headers' }, { status: 400 })
    }

    console.log('Google Drive webhook received:', { channelId, resourceId, state })

    // Get watch info from database
    const watch = await getDriveWatchByChannel(channelId)
    if (!watch || watch.resource_id !== resourceId) {
      console.log('Watch not found or resource ID mismatch')
      return NextResponse.json({ error: 'Watch not found' }, { status: 404 })
    }

    // Get the source document
    const { data: source, error: sourceError } = await supabase
      .from('sources_google_docs')
      .select('*')
      .eq('google_file_id', watch.google_file_id)
      .single()

    if (sourceError || !source) {
      console.log('Source not found for file:', watch.google_file_id)
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    // Get user's Google tokens
    const googleAccount = await getGoogleTokens(source.added_by)
    if (!googleAccount) {
      console.log('Google account not found for user:', source.added_by)
      return NextResponse.json({ error: 'Google account not found' }, { status: 404 })
    }

    // Refresh tokens if needed
    const tokens = await refreshTokensIfNeeded({
      access_token: googleAccount.access_token,
      refresh_token: googleAccount.refresh_token,
      expiry_date: new Date(googleAccount.token_expiry).getTime()
    })

    // Get updated file metadata
    const { file, permissionsHash } = await getFileMetadata(watch.google_file_id, tokens)

    // Check if document was actually modified
    if (source.latest_revision_id === file.headRevisionId) {
      console.log('Document not modified, skipping update')
      return NextResponse.json({ success: true, message: 'No changes detected' })
    }

    console.log('Document modified, re-indexing:', {
      oldRevision: source.latest_revision_id,
      newRevision: file.headRevisionId
    })

    // Fetch updated document content
    const docs = createDocsClient(tokens)
    const doc = await docs.documents.get({ documentId: watch.google_file_id })

    // Flatten and chunk the updated document
    const blocks = flattenDoc(doc.data)
    const chunks = chunkBlocks(blocks)

    // Update the source and chunks in a transaction
    await supabase.rpc('update_google_doc_source_and_chunks', {
      source_id: source.id,
      new_revision_id: file.headRevisionId,
      new_modified_time: file.modifiedTime,
      new_permissions_hash: permissionsHash,
      new_chunks: chunks.map((chunk, index) => ({
        space_id: source.space_id,
        source_id: source.id,
        heading_path: chunk.headingPath,
        text: chunk.text,
        metadata: chunk.metadata,
        chunk_index: index
      }))
    })

    console.log('Successfully updated Google Doc:', {
      sourceId: source.id,
      chunksCount: chunks.length
    })

    return NextResponse.json({ 
      success: true, 
      message: 'Document updated successfully',
      chunksCount: chunks.length
    })

  } catch (error) {
    console.error('Google Drive webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

