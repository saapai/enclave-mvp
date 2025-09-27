import { supabase } from './supabase'
import { ENV } from './env'

// Use Mistral embeddings
const MISTRAL_API_KEY = ENV.MISTRAL_API_KEY
const MISTRAL_EMBED_MODEL = process.env.MISTRAL_EMBED_MODEL || 'mistral-embed'

export async function embedText(text: string): Promise<number[] | null> {
  if (!MISTRAL_API_KEY) {
    console.error('MISTRAL_API_KEY is not set')
    return null
  }
  const cleaned = (text || '').slice(0, 200000)
  const res = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MISTRAL_EMBED_MODEL,
      input: cleaned,
    })
  })
  if (!res.ok) {
    console.error('Mistral embed error:', await res.text())
    return null
  }
  const json = await res.json()
  // Mistral returns { data: [{ embedding: number[] }] }
  return (json?.data?.[0]?.embedding as number[]) || null
}

export async function upsertResourceEmbedding(resourceId: string, text: string): Promise<boolean> {
  const embedding = await embedText(text)
  if (!embedding) return false
  const { error } = await (supabase as any)
    .from('resource_embedding')
    .upsert({ resource_id: resourceId, embedding, updated_at: new Date().toISOString() })
  if (error) {
    console.error('Embedding upsert error:', error)
    return false
  }
  return true
}


