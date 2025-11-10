/**
 * Re-embed all resources with 1024 dimensions (was 1536)
 * 
 * This script:
 * 1. Fetches all resources from the database
 * 2. Regenerates embeddings with 1024 dimensions
 * 3. Regenerates chunks with 1024-dim embeddings
 * 
 * Run with: npx tsx scripts/reembed-with-1024-dims.ts
 */

import { supabaseAdmin } from '../src/lib/supabase'
import { upsertResourceEmbedding, upsertResourceChunks } from '../src/lib/embeddings'

async function reembedAllResources() {
  if (!supabaseAdmin) {
    console.error('❌ supabaseAdmin is not available')
    return
  }

  console.log('🔄 Fetching all resources...')
  
  const { data: resources, error } = await supabaseAdmin
    .from('resource')
    .select('id, title, body')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ Error fetching resources:', error)
    return
  }

  if (!resources || resources.length === 0) {
    console.log('✅ No resources found')
    return
  }

  console.log(`📦 Found ${resources.length} resources to re-embed`)
  
  let successCount = 0
  let failCount = 0

  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i]
    const progress = `[${i + 1}/${resources.length}]`
    
    try {
      console.log(`${progress} Processing: ${resource.title || 'Untitled'} (${resource.id.substring(0, 8)}...)`)
      
      // Generate resource-level embedding
      const textForEmbed = [resource.title || '', resource.body || '']
        .filter(Boolean)
        .join('\n\n')
      
      if (textForEmbed.trim().length > 0) {
        await upsertResourceEmbedding(resource.id, textForEmbed)
        console.log(`  ✓ Resource embedding updated`)
      }
      
      // Generate chunks with embeddings
      if (resource.body && resource.body.trim().length > 0) {
        await upsertResourceChunks(resource.id, resource.body)
        console.log(`  ✓ Chunks updated`)
      }
      
      successCount++
      
      // Rate limit to avoid overwhelming OpenAI API
      await new Promise(resolve => setTimeout(resolve, 200))
      
    } catch (err) {
      console.error(`  ❌ Failed:`, err)
      failCount++
    }
  }

  console.log('\n📊 Summary:')
  console.log(`  ✅ Success: ${successCount}`)
  console.log(`  ❌ Failed: ${failCount}`)
  console.log(`  📦 Total: ${resources.length}`)
}

// Run the script
reembedAllResources()
  .then(() => {
    console.log('\n✨ Re-embedding complete!')
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n💥 Fatal error:', err)
    process.exit(1)
  })

