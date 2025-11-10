/**
 * Re-embed all resources with 1536 dimensions (OpenAI text-embedding-3-small default)
 * 
 * This script:
 * 1. Fetches all resources from the database
 * 2. Regenerates embeddings with 1536 dimensions
 * 3. Regenerates chunks with 1536-dim embeddings
 * 
 * Prerequisites:
 * - Run database/migrations/migrate-to-1536-dimensions.sql first
 * - Set environment variables in .env.local
 * 
 * Run with: 
 *   source .env.local && npx tsx scripts/reembed-with-1536-dims.ts
 */

import { supabaseAdmin } from '../src/lib/supabase'
import { upsertResourceEmbedding, upsertResourceChunks } from '../src/lib/embeddings'

async function reembedAllResources() {
  if (!supabaseAdmin) {
    console.error('❌ supabaseAdmin is not available')
    console.error('   Make sure to set SUPABASE_SERVICE_ROLE_KEY in .env.local')
    return
  }

  console.log('🔄 Fetching all resources...')
  
  const { data: resources, error } = await supabaseAdmin
    .from('resource')
    .select('id, title, body, type')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ Error fetching resources:', error)
    return
  }

  if (!resources || resources.length === 0) {
    console.log('✅ No resources found')
    return
  }

  console.log(`📦 Found ${resources.length} resources to re-embed with 1536 dimensions`)
  console.log('⏱️  This will take approximately', Math.ceil(resources.length * 0.3), 'minutes')
  console.log('')
  
  let successCount = 0
  let failCount = 0
  const startTime = Date.now()

  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i]
    const progress = `[${i + 1}/${resources.length}]`
    
    try {
      const title = resource.title || 'Untitled'
      const preview = title.length > 50 ? title.substring(0, 47) + '...' : title
      console.log(`${progress} ${preview} (${resource.id.substring(0, 8)}...)`)
      
      // Generate resource-level embedding
      const textForEmbed = [resource.title || '', resource.body || '']
        .filter(Boolean)
        .join('\n\n')
      
      if (textForEmbed.trim().length > 0) {
        const embeddingSuccess = await upsertResourceEmbedding(resource.id, textForEmbed)
        if (embeddingSuccess) {
          console.log(`  ✓ Resource embedding (1536 dims)`)
        } else {
          console.log(`  ⚠️  Resource embedding failed`)
        }
      }
      
      // Generate chunks with embeddings
      if (resource.body && resource.body.trim().length > 0) {
        await upsertResourceChunks(resource.id, resource.body)
        console.log(`  ✓ Chunks generated`)
      }
      
      successCount++
      
      // Rate limit to avoid overwhelming OpenAI API (5 requests/sec = 200ms delay)
      await new Promise(resolve => setTimeout(resolve, 200))
      
    } catch (err) {
      console.error(`  ❌ Failed:`, err)
      failCount++
    }
    
    // Progress update every 10 resources
    if ((i + 1) % 10 === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const rate = (i + 1) / elapsed
      const remaining = Math.ceil((resources.length - i - 1) / rate)
      console.log(`  ⏱️  Progress: ${i + 1}/${resources.length} (${remaining}s remaining)\n`)
    }
  }

  const totalTime = Math.floor((Date.now() - startTime) / 1000)
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary:')
  console.log('  ✅ Success: ', successCount)
  console.log('  ❌ Failed:  ', failCount)
  console.log('  📦 Total:   ', resources.length)
  console.log('  ⏱️  Time:    ', totalTime, 'seconds')
  console.log('='.repeat(60))
}

// Run the script
reembedAllResources()
  .then(() => {
    console.log('\n✨ Re-embedding complete!')
    console.log('🚀 Deploy your changes and test SMS queries')
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n💥 Fatal error:', err)
    process.exit(1)
  })

