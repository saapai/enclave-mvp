#!/usr/bin/env tsx
/**
 * Ensure all resources have embeddings
 * Run this after uploading new resources to backfill embeddings
 */

import { supabaseAdmin } from '../src/lib/supabase'
import { upsertResourceEmbedding } from '../src/lib/embeddings'

async function main() {
  if (!supabaseAdmin) {
    console.error('supabaseAdmin client not available. Did you load .env.local?')
    process.exit(1)
  }

  console.log('Checking for resources without embeddings...\n')

  // Get all resources
  const { data: resources, error: resError } = await supabaseAdmin
    .from('resource')
    .select('id, title, body, type, space_id')
    .order('created_at', { ascending: false })

  if (resError) {
    console.error('Failed to fetch resources:', resError)
    process.exit(1)
  }

  console.log(`Total resources: ${resources.length}`)

  // Get all embeddings
  const { data: embeddings, error: embError } = await supabaseAdmin
    .from('resource_embedding')
    .select('resource_id')

  if (embError) {
    console.error('Failed to fetch embeddings:', embError)
    process.exit(1)
  }

  const embeddingIds = new Set(embeddings.map(e => e.resource_id))
  console.log(`Total embeddings: ${embeddings.length}`)

  // Find missing
  const missing = resources.filter(r => !embeddingIds.has(r.id))
  console.log(`Missing embeddings: ${missing.length}\n`)

  if (missing.length === 0) {
    console.log('✅ All resources have embeddings!')
    return
  }

  console.log('Generating embeddings for missing resources...\n')

  let successCount = 0
  let failCount = 0

  for (const resource of missing) {
    const text = `${resource.title || ''} ${resource.body || ''}`.trim()
    if (!text) {
      console.log(`⏭️  Skipping ${resource.id} (empty text)`)
      continue
    }

    console.log(`Processing: ${resource.title} (${resource.type})`)
    
    try {
      const success = await upsertResourceEmbedding(resource.id, text)
      if (success) {
        successCount++
        console.log(`  ✅ Generated embedding`)
      } else {
        failCount++
        console.log(`  ❌ Failed to generate embedding`)
      }
    } catch (err) {
      failCount++
      console.error(`  ❌ Error:`, err)
    }

    // Rate limit: wait 100ms between requests
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`\n✅ Success: ${successCount}`)
  console.log(`❌ Failed: ${failCount}`)
  console.log(`⏭️  Skipped: ${missing.length - successCount - failCount}`)
}

main().catch(err => {
  console.error('Script failed:', err)
  process.exit(1)
})

