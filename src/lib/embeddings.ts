import { supabase, supabaseAdmin } from './supabase'
import { ENV } from './env'

// Use OpenAI embeddings (much faster and more reliable than Mistral)
const OPENAI_API_KEY = ENV.OPENAI_API_KEY
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
// OpenAI text-embedding-3-small naturally produces 1536 dimensions
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || '1536')
const OPENAI_EMBED_TIMEOUT_MS = Number(process.env.OPENAI_EMBED_TIMEOUT_MS || '9000')
const OPENAI_EMBED_ATTEMPTS = Number(process.env.OPENAI_EMBED_ATTEMPTS || '3')
const OPENAI_EMBED_RETRY_DELAYS_MS = [300, 800]

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set')
    return null
  }

  const cleaned = (text || '').slice(0, 8000)
  console.log(`Generating embedding for text: ${cleaned.slice(0, 100)}...`)

  for (let attempt = 1; attempt <= OPENAI_EMBED_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OPENAI_EMBED_TIMEOUT_MS)

    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: cleaned,
          dimensions: EMBEDDING_DIMENSIONS
        }),
        signal: controller.signal
      })

      clearTimeout(timer)

      if (!res.ok) {
        const errorText = await res.text()
        console.error(`OpenAI embedding error (${res.status}):`, errorText)
        continue
      }

      const json = await res.json()
      const embedding = json?.data?.[0]?.embedding as number[]

      if (!embedding || embedding.length === 0) {
        console.error('OpenAI returned empty embedding')
        continue
      }

      console.log(`Generated embedding with ${embedding.length} dimensions using ${EMBEDDING_MODEL}`)
      return embedding
    } catch (err: any) {
      clearTimeout(timer)
      if (controller.signal.aborted) {
        console.warn(`OpenAI embedding attempt ${attempt} timed out after ${OPENAI_EMBED_TIMEOUT_MS}ms`)
      } else {
        console.error(`OpenAI embedding exception (attempt ${attempt}):`, err)
      }

      const backoff = OPENAI_EMBED_RETRY_DELAYS_MS[attempt - 1]
      if (backoff) {
        await new Promise(resolve => setTimeout(resolve, backoff))
      }
    }
  }

  return null
}

export async function embedText(text: string): Promise<number[] | null> {
  return generateEmbedding(text)
}

export async function upsertResourceEmbedding(resourceId: string, text: string): Promise<boolean> {
  const embedding = await embedText(text)
  if (!embedding) {
    console.log('No embedding generated, skipping upsert')
    return false
  }
  console.log('Upserting embedding for resource:', resourceId, 'with dimensions:', embedding.length)

  const client = supabaseAdmin || supabase
  if (!client) {
    console.error('No Supabase client available for embedding upsert')
    return false
  }

  const { error } = await client
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

  const client = supabaseAdmin || supabase
  if (!client) {
    console.error('No Supabase client available for chunk upsert')
    return
  }

  try {
    await client
      .from('resource_chunk')
      .delete()
      .eq('resource_id', resourceId)
  } catch (err) {
    console.error('Failed to clear existing chunks:', err)
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    let embedding: number[] | null = null
    try {
      embedding = await embedText(chunk)
    } catch (err) {
      console.error('Chunk embedding failed:', err)
    }

    await client
      .from('resource_chunk')
      .insert({
        resource_id: resourceId,
        chunk_index: i,
        chunk_text: chunk,
        embedding
      })
  }
}


