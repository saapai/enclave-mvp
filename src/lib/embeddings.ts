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
  console.log('Generating embedding for text:', cleaned.slice(0, 100) + '...')
  
  // Try different Mistral embedding models
  const models = ['mistral-embed', 'mistral-large-latest', 'mistral-small-latest']
  
  for (const model of models) {
    console.log('Trying model:', model)
    const res = await fetch('https://api.mistral.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        input: cleaned,
      })
    })
    
    if (res.ok) {
      const json = await res.json()
      const embedding = json?.data?.[0]?.embedding as number[]
      console.log('Generated embedding with dimensions:', embedding?.length, 'using model:', model)
      return embedding || null
    } else {
      const errorText = await res.text()
      console.log('Model', model, 'failed:', res.status, errorText)
    }
  }
  
  console.error('All embedding models failed')
  return null
}

export async function upsertResourceEmbedding(resourceId: string, text: string): Promise<boolean> {
  const embedding = await embedText(text)
  if (!embedding) {
    console.log('No embedding generated, skipping upsert')
    return false
  }
  console.log('Upserting embedding for resource:', resourceId, 'with dimensions:', embedding.length)
  const { error } = await (supabase as any)
    .from('resource_embedding')
    .upsert({ resource_id: resourceId, embedding, updated_at: new Date().toISOString() })
  if (error) {
    console.error('Embedding upsert error:', error)
    return false
  }
  console.log('Successfully upserted embedding for resource:', resourceId)
  return true
}

export async function upsertResourceChunks(resourceId: string, text: string): Promise<void> {
  // Simple greedy chunking ~1.5k chars per chunk, respecting paragraph breaks
  const MAX_CHARS = 1500
  const paragraphs = text.split(/\n\n+/)
  const chunks: string[] = []
  let current = ''
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > MAX_CHARS) {
      if (current.trim()) chunks.push(current.trim())
      current = p
    } else {
      current = current ? current + '\n\n' + p : p
    }
  }
  if (current.trim()) chunks.push(current.trim())

  // Insert chunks and embeddings (best-effort)
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    let embedding: number[] | null = null
    try {
      embedding = await embedText(chunk)
    } catch { /* ignore */ }
    await (supabase as any)
      .from('resource_chunk')
      .insert({
        resource_id: resourceId,
        chunk_index: i,
        chunk_text: chunk,
        embedding
      })
  }
}


