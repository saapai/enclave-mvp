import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { upsertResourceEmbedding } from '@/lib/embeddings'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const { data: resources, error } = await supabase
      .from('resource')
      .select('id, title, body')
      .eq('space_id', DEFAULT_SPACE_ID)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    let success = 0
    for (const r of resources || []) {
      const text = [r.title, r.body].filter(Boolean).join('\n\n')
      const ok = await upsertResourceEmbedding((r as any).id, text)
      if (ok) success += 1
    }

    return NextResponse.json({ indexed: success })
  } catch (e) {
    console.error('Reindex error:', e)
    return NextResponse.json({ error: 'Failed to reindex' }, { status: 500 })
  }
}


