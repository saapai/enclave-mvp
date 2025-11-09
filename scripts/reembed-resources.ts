import { supabaseAdmin } from '../src/lib/supabase'
import { upsertResourceEmbedding, upsertResourceChunks } from '../src/lib/embeddings'

async function reembedAllResources() {
  if (!supabaseAdmin) {
    console.error('Supabase admin client is not configured. Check environment variables.')
    process.exit(1)
  }

  const PAGE_SIZE = 25
  let offset = 0
  let totalProcessed = 0

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('resource')
      .select('id, body')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('Failed to fetch resources:', error)
      break
    }

    if (!data || data.length === 0) {
      console.log('No more resources to re-embed.')
      break
    }

    for (const resource of data as Array<{ id: string; body?: string | null }>) {
      const text = resource.body || ''
      if (!text.trim()) {
        console.log(`Skipping resource ${resource.id} (no text available)`)
        continue
      }

      console.log(`Re-embedding resource ${resource.id} (${text.length} chars)`)
      await upsertResourceEmbedding(resource.id, text)
      await upsertResourceChunks(resource.id, text)
      totalProcessed += 1

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    offset += data.length
  }

  console.log(`Re-embedded ${totalProcessed} resources.`)
}

reembedAllResources()
  .then(() => {
    console.log('Re-embedding completed.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Re-embedding script failed:', err)
    process.exit(1)
  })
