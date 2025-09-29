import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { embedText } from '@/lib/embeddings'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '200', 10)
    const resourceId = searchParams.get('resourceId') || undefined

    // Fetch chunks missing embeddings
    let query = supabase
      .from('resource_chunk' as any)
      .select('id, resource_id, chunk_index, chunk_text, embedding')
      .is('embedding', null)
      .limit(limit)

    if (resourceId) {
      query = (query as any).eq('resource_id', resourceId)
    }

    const { data: chunks, error } = await query
    if (error) throw error

    let updated = 0
    for (const ch of (chunks || [])) {
      try {
        const emb = await embedText((ch as any).chunk_text as string)
        if (!emb) continue
        const { error: upErr } = await (supabase as any)
          .from('resource_chunk')
          .update({ embedding: emb })
          .eq('id', (ch as any).id)
        if (!upErr) updated += 1
      } catch { /* ignore */ }
    }

    return NextResponse.json({ updated, scanned: (chunks || []).length })
  } catch (e) {
    console.error('Chunk reindex error:', e)
    return NextResponse.json({ error: 'Failed to reindex chunks' }, { status: 500 })
  }
}


