import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { embedText } from '@/lib/embeddings'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim() || ''
    const limit = parseInt(searchParams.get('limit') || '10', 10)

    if (!query) {
      return NextResponse.json({ results: [] })
    }

    // Generate query embedding
    const queryEmbedding = await embedText(query)
    if (!queryEmbedding) {
      return NextResponse.json({ results: [] })
    }

    // Vector search in Google Docs chunks
    const { data: vectorResults, error: vectorError } = await supabase
      .rpc('search_google_docs_vector', {
        query_embedding: queryEmbedding,
        target_space_id: DEFAULT_SPACE_ID,
        limit_count: limit,
        offset_count: 0
      })

    if (vectorError) {
      console.error('Vector search error:', vectorError)
      return NextResponse.json({ results: [] })
    }

    // Get source information for results
    const sourceIds = [...new Set(vectorResults.map((r: any) => r.source_id))]
    const { data: sources, error: sourcesError } = await supabase
      .from('sources_google_docs')
      .select('id, title, google_file_id, web_view_link')
      .in('id', sourceIds)

    if (sourcesError) {
      console.error('Sources fetch error:', sourcesError)
      return NextResponse.json({ results: [] })
    }

    // Combine results with source info
    const results = vectorResults.map((chunk: any) => {
      const source = sources.find(s => s.id === chunk.source_id)
      return {
        id: chunk.id,
        source_id: chunk.source_id,
        heading_path: chunk.heading_path,
        text: chunk.text,
        metadata: chunk.metadata,
        similarity: chunk.similarity,
        source: source ? {
          title: source.title,
          file_id: source.google_file_id,
          web_view_link: source.web_view_link
        } : null
      }
    })

    return NextResponse.json({ results })

  } catch (error) {
    console.error('Google Docs search error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}









