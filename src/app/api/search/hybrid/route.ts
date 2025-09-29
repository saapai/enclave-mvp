import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { embedText } from '@/lib/embeddings'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    // Allow unauthenticated locally to test quickly
    const isDev = process.env.NODE_ENV !== 'production'
    if (!userId && !isDev) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim() || ''
    const limit = parseInt(searchParams.get('limit') || '10', 10)
    if (!query) return NextResponse.json({ results: [] })

    // 1) Full-text hits (best effort)
    const { data: ftsHits, error: ftsErr } = await supabase.rpc('search_resources', {
      search_query: query,
      target_space_id: DEFAULT_SPACE_ID,
      limit_count: limit,
      offset_count: 0
    })

    // 2) Vector hits (if resource_embedding exists and embeddings configured)
    let vectorHits: Array<{ id: string; score: number }> = []
    try {
      const qEmbed = await embedText(query)
      if (qEmbed) {
        const { data: vec } = await (supabase as any).rpc('search_resources_vector', {
          query_embedding: qEmbed,
          target_space_id: DEFAULT_SPACE_ID,
          limit_count: limit,
          offset_count: 0
        })
        vectorHits = (vec || []).map((v: any) => ({ id: v.id, score: v.score }))
      }
    } catch { /* ignore */ }

    // 2c) Chunk vector hits (if resource_chunk embeddings exist and RPC available)
    let chunkVectorScores: Record<string, number> = {}
    try {
      const qEmbedChunks = await embedText(query)
      if (qEmbedChunks) {
        const { data: chunkVec } = await (supabase as any).rpc('search_resource_chunks_vector', {
          query_embedding: qEmbedChunks,
          target_space_id: DEFAULT_SPACE_ID,
          limit_count: limit * 3,
          offset_count: 0
        })
        // Reduce chunk results to per-resource best score
        for (const row of (chunkVec || [])) {
          const rid = row.resource_id as string
          const score = Number(row.score) || 0
          if (score > (chunkVectorScores[rid] ?? -Infinity)) {
            chunkVectorScores[rid] = score
          }
        }
      }
    } catch { /* ignore */ }

    // 2b) Chunk vector hits (resource_chunk)
    try {
      const { data: chunkCheck } = await (supabase as any)
        .from('resource_chunk')
        .select('id')
        .limit(0)
      if (chunkCheck) {
        const qEmbed2 = await embedText(query)
        if (qEmbed2) {
          // Cosine search over chunk embeddings using raw SQL via RPC is preferred,
          // but with PostgREST we can approximate by server-side function. If not present,
          // skip chunk vectors.
          // Here we fallback to resource text search only; vector chunk search requires an extra RPC.
        }
      }
    } catch { /* ignore */ }

    // 3) Fuse (reciprocal rank fusion)
    const rrf: Record<string, number> = {}
    const kRRF = 60
    ;(ftsHits || []).forEach((h: any, idx: number) => {
      rrf[h.id] = (rrf[h.id] || 0) + 1 / (kRRF + idx + 1)
    })
    vectorHits.forEach((h, idx) => {
      rrf[h.id] = (rrf[h.id] || 0) + 1 / (kRRF + idx + 1)
    })
    // Fold in chunk vector scores (order by descending score)
    if (Object.keys(chunkVectorScores).length > 0) {
      const sortedChunkIds = Object.keys(chunkVectorScores).sort((a, b) => (chunkVectorScores[b] - chunkVectorScores[a]))
      sortedChunkIds.forEach((id, idx) => {
        rrf[id] = (rrf[id] || 0) + 1 / (kRRF + idx + 1)
      })
    }
    let ids = Object.keys(rrf).sort((a, b) => rrf[b] - rrf[a]).slice(0, limit)

    // Fallback: if FTS/vector produced nothing (or FTS errored), run ilike query
    if ((ids.length === 0) || ftsErr) {
      const { data: likeResources, error: likeErr } = await supabase
        .from('resource')
        .select(`
          *,
          tags:resource_tag(
            tag:tag(*)
          ),
          event_meta(*),
          created_by_user:app_user(*)
        `)
        .eq('space_id', DEFAULT_SPACE_ID)
        .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
        .order('updated_at', { ascending: false })
        .limit(limit)

      if (!likeErr && likeResources && likeResources.length > 0) {
        const transformed = likeResources.map((r: any) => ({
          ...r,
          tags: (r?.tags || []).map((rt: any) => rt.tag).filter(Boolean) || []
        }))
        return NextResponse.json({ results: transformed })
      }
    }

    if (ids.length === 0) return NextResponse.json({ results: [] })

    const { data: resources, error: expandError } = await supabase
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*),
        created_by_user:app_user(*)
      `)
      .in('id', ids)

    if (expandError) throw expandError

    // Preserve fused order
    const order: Record<string, number> = {}
    ids.forEach((id: string, idx: number) => (order[id] = idx))
    const results = (resources || []).sort((a, b) => order[a.id] - order[b.id])

    const transformed = results.map((r) => ({
      ...r,
      tags: (r as any).tags?.map((rt: any) => rt.tag).filter(Boolean) || []
    }))

    return NextResponse.json({ results: transformed })
  } catch (e) {
    console.error('Hybrid search error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


