import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { embedText } from '@/lib/embeddings'
import { ENV } from '@/lib/env'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

function buildContextFromResources(resources: Array<Record<string, any>>, maxChars = 6000): string {
  const chunks: string[] = []
  let used = 0
  for (const r of resources) {
    const header = `Title: ${r.title}\nType: ${r.type}${r.url ? `\nURL: ${r.url}` : ''}`
    const bodyRaw: string = r.body || ''
    const body = bodyRaw.replace(/\s+/g, ' ').trim()
    const snippet = body.length > 700 ? body.slice(0, 700) + '…' : body
    const tags = (r.tags || []).map((t: any) => t.tag?.name).filter(Boolean)
    const tagLine = tags.length ? `\nTags: ${tags.join(', ')}` : ''
    const block = `${header}${tagLine}\nContent: ${snippet}\n---\n`
    if (used + block.length > maxChars) break
    chunks.push(block)
    used += block.length
  }
  return chunks.join('\n')
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    // Allow unauthenticated in dev/testing
    const _testUserId = userId || '00000000-0000-0000-0000-000000000000'

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim() || ''
    const k = parseInt(searchParams.get('k') || '6', 10)

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Hybrid retrieval: FTS + vector with reciprocal rank fusion
    let ftsHits: any[] = []
    try {
      const { data, error: ftsErr } = await supabase.rpc('search_resources', {
        search_query: query,
        target_space_id: DEFAULT_SPACE_ID,
        limit_count: k,
        offset_count: 0
      })
      if (ftsErr) {
        console.warn('FTS search failed, falling back to simple search:', ftsErr)
        // Fallback to simple search
        const { data: fallbackData } = await supabase
          .from('resource')
          .select('id')
          .eq('space_id', DEFAULT_SPACE_ID)
          .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
          .limit(k)
        ftsHits = fallbackData || []
      } else {
        ftsHits = data || []
      }
    } catch (err) {
      console.warn('FTS search error, using fallback:', err)
      // Fallback to simple search
      const { data: fallbackData } = await supabase
        .from('resource')
        .select('id')
        .eq('space_id', DEFAULT_SPACE_ID)
        .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
        .limit(k)
      ftsHits = fallbackData || []
    }

    let vectorHits: Array<{ id: string; score: number }> = []
    try {
      const qEmbed = await embedText(query)
      if (qEmbed) {
        const { data: vec } = await (supabase as any).rpc('search_resources_vector', {
          query_embedding: qEmbed,
          target_space_id: DEFAULT_SPACE_ID,
          limit_count: k,
          offset_count: 0
        })
        vectorHits = (vec || []).map((v: any) => ({ id: v.id, score: v.score }))
      }
    } catch { /* ignore */ }

    const rrf: Record<string, number> = {}
    const kRRF = 60
    ;(ftsHits || []).forEach((h: any, idx: number) => {
      rrf[h.id] = (rrf[h.id] || 0) + 1 / (kRRF + idx + 1)
    })
    vectorHits.forEach((h, idx) => {
      rrf[h.id] = (rrf[h.id] || 0) + 1 / (kRRF + idx + 1)
    })

    const ids = Object.keys(rrf).sort((a, b) => rrf[b] - rrf[a]).slice(0, k)
    let resources: Array<Record<string, any>> = []
    if (ids.length > 0) {
      const { data: expanded, error: expandError } = await supabase
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
      const order: Record<string, number> = {}
      ids.forEach((id: string, idx: number) => (order[id] = idx))
      resources = (expanded || []).sort((a, b) => order[a.id] - order[b.id])
    }

    const context = buildContextFromResources(resources, 6000)

    const mistralApiKey = ENV.MISTRAL_API_KEY
    if (!mistralApiKey) {
      return NextResponse.json({ error: 'Mistral API key not configured' }, { status: 500 })
    }

    const systemPrompt = `You are a helpful assistant for a workspace. Answer the user's question using ONLY the provided context. If the answer isn't in the context, say you don't have that information. Keep answers concise.`
    const userPrompt = `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer based strictly on the context above.`

    const aiRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mistralApiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.2,
      })
    })

    if (!aiRes.ok) {
      const errorData = await aiRes.text()
      console.error('Mistral API error:', errorData)
      return NextResponse.json({ error: 'Failed to get AI answer' }, { status: 500 })
    }

    const aiJson = await aiRes.json()
    const answer = aiJson.choices?.[0]?.message?.content || 'No answer generated'

    // Minimal source list for display
    const sources = (resources || []).map((r) => ({ id: r.id, title: r.title, url: r.url, type: r.type }))

    // Append sources to the answer for UI that renders the raw content
    const sourcesText = sources.length
      ? `\n\nSources:\n${sources.map((s, i) => `${i + 1}. ${s.title}${s.url ? ` - ${s.url}` : ''}`).join('\n')}`
      : ''

    return NextResponse.json({ answer: `${answer}${sourcesText}`.trim(), sources, query })
  } catch (error) {
    console.error('Ask API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


