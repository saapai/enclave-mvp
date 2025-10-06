import { supabase } from './supabase'
import { ENV } from './env'
import { logger } from './logger'

// Use Mistral embeddings
const MISTRAL_API_KEY = ENV.MISTRAL_API_KEY
const MISTRAL_EMBED_MODEL = process.env.MISTRAL_EMBED_MODEL || 'mistral-embed'

export async function embedText(text: string): Promise<number[] | null> {
  if (!MISTRAL_API_KEY) {
    logger.error('MISTRAL_API_KEY is not set')
    return null
  }
  
  const cleaned = (text || '').slice(0, 200000)
  logger.debug('Generating embedding for text', { 
    textLength: cleaned.length, 
    preview: cleaned.slice(0, 100) + '...' 
  })
  
  // Try different Mistral embedding models
  const models = ['mistral-embed', 'mistral-large-latest', 'mistral-small-latest']
  
  for (const model of models) {
    try {
      logger.debug('Trying embedding model', { model })
      
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
        
        if (embedding && Array.isArray(embedding)) {
          logger.debug('Generated embedding successfully', { 
            model, 
            dimensions: embedding.length 
          })
          return embedding
        } else {
          logger.warn('Invalid embedding response', { model, response: json })
        }
      } else {
        const errorText = await res.text()
        logger.warn('Embedding model failed', { 
          model, 
          status: res.status, 
          error: errorText 
        })
      }
    } catch (error) {
      logger.error('Embedding request failed', error as Error, { model })
    }
  }
  
  logger.error('All embedding models failed')
  return null
}

export async function upsertResourceEmbedding(resourceId: string, text: string): Promise<boolean> {
  try {
    const embedding = await embedText(text)
    if (!embedding) {
      logger.warn('No embedding generated, skipping upsert', { resourceId })
      return false
    }
    
    logger.debug('Upserting embedding for resource', { 
      resourceId, 
      dimensions: embedding.length 
    })
    
    const { error } = await supabase
      .from('resource_embedding')
      .upsert({ 
        resource_id: resourceId, 
        embedding, 
        updated_at: new Date().toISOString() 
      })
      
    if (error) {
      logger.error('Embedding upsert error', error, { resourceId })
      return false
    }
    
    logger.debug('Successfully upserted embedding for resource', { resourceId })
    return true
  } catch (error) {
    logger.error('Embedding upsert failed', error as Error, { resourceId })
    return false
  }
}

export async function upsertResourceChunks(resourceId: string, text: string): Promise<void> {
  try {
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

    logger.debug('Processing resource chunks', { 
      resourceId, 
      chunkCount: chunks.length 
    })

    // Insert chunks and embeddings (best-effort)
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      let embedding: number[] | null = null
      
      try {
        embedding = await embedText(chunk)
      } catch (error) {
        logger.warn('Failed to generate embedding for chunk', error as Error, { 
          resourceId, 
          chunkIndex: i 
        })
      }
      
      const { error: insertError } = await supabase
        .from('resource_chunk')
        .insert({
          resource_id: resourceId,
          chunk_index: i,
          chunk_text: chunk,
          embedding
        })
        
      if (insertError) {
        logger.error('Failed to insert chunk', insertError, { 
          resourceId, 
          chunkIndex: i 
        })
      }
    }
    
    logger.debug('Successfully processed resource chunks', { 
      resourceId, 
      chunkCount: chunks.length 
    })
  } catch (error) {
    logger.error('Resource chunk processing failed', error as Error, { resourceId })
  }
}


