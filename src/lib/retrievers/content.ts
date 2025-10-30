import { searchResourcesHybrid } from '@/lib/search'
import { supabase } from '@/lib/supabase'

export type RetrievedItem = {
  layer: 'content'
  id: string
  title?: string
  snippet: string
  uri?: string
  features: Record<string, number | string | boolean>
  score: number
}

export async function retrieveContent(query: string, spaceIds: string[], limit = 5): Promise<RetrievedItem[]> {
  const all: any[] = []
  for (const spaceId of spaceIds) {
    const results = await searchResourcesHybrid(query, spaceId, {}, { limit, offset: 0 }, undefined)
    all.push(...results)
  }
  const seen = new Set<string>()
  const items: RetrievedItem[] = []
  for (const r of all) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    items.push({
      layer: 'content',
      id: String(r.id),
      title: r.title,
      snippet: (r.body || r.title || '').slice(0, 800),
      uri: r.url || undefined,
      features: { source_type: r.type || 'doc' },
      score: Number(r.score || r.rank || 0),
    })
  }
  return items.sort((a, b) => b.score - a.score).slice(0, limit)
}


