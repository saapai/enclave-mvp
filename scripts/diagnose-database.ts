#!/usr/bin/env tsx
/**
 * Database Diagnostic Script
 * 
 * Inspects Supabase database to understand:
 * - What workspaces exist
 * - What resources exist in each workspace
 * - Whether resources have embeddings
 * - Whether FTS is working
 */

import { supabaseAdmin } from '../src/lib/supabase'

async function diagnoseDatabase() {
  console.log('🔍 Starting database diagnosis...\n')

  if (!supabaseAdmin) {
    console.error('❌ supabaseAdmin is not available')
    process.exit(1)
  }

  // 1. Check workspaces
  console.log('📁 Checking workspaces...')
  const { data: spaces, error: spacesError } = await supabaseAdmin
    .from('space')
    .select('id, name, created_at')
    .order('created_at', { ascending: false })

  if (spacesError) {
    console.error('❌ Error fetching spaces:', spacesError)
  } else {
    console.log(`✅ Found ${spaces?.length || 0} workspaces:`)
    spaces?.forEach((space, i) => {
      console.log(`   ${i + 1}. ${space.name} (${space.id})`)
    })
  }
  console.log()

  // 2. Check resources by workspace
  console.log('📄 Checking resources by workspace...')
  if (spaces && spaces.length > 0) {
    for (const space of spaces) {
      const { data: resources, error: resourcesError } = await supabaseAdmin
        .from('resource')
        .select('id, title, type, source, created_at, body')
        .eq('space_id', space.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (resourcesError) {
        console.error(`❌ Error fetching resources for ${space.name}:`, resourcesError)
      } else {
        console.log(`\n   📦 ${space.name} (${space.id}):`)
        console.log(`      Total resources: ${resources?.length || 0}`)
        
        if (resources && resources.length > 0) {
          // Group by source
          const bySource = resources.reduce((acc: any, r: any) => {
            acc[r.source] = (acc[r.source] || 0) + 1
            return acc
          }, {})
          console.log(`      By source:`, bySource)
          
          // Show sample titles
          console.log(`      Sample titles:`)
          resources.slice(0, 5).forEach((r: any) => {
            const bodyPreview = r.body ? ` (${r.body.substring(0, 50)}...)` : ''
            console.log(`        - ${r.title} [${r.type}]${bodyPreview}`)
          })
        } else {
          console.log(`      ⚠️  No resources found in this workspace`)
        }
      }
    }
  }
  console.log()

  // 3. Check for SEP workspaces specifically
  console.log('🔎 Checking SEP workspaces...')
  const { data: sepSpaces, error: sepError } = await supabaseAdmin
    .from('space')
    .select('id, name')
    .ilike('name', '%SEP%')

  if (sepError) {
    console.error('❌ Error fetching SEP spaces:', sepError)
  } else {
    console.log(`✅ Found ${sepSpaces?.length || 0} SEP workspaces:`)
    sepSpaces?.forEach((space, i) => {
      console.log(`   ${i + 1}. ${space.name} (${space.id})`)
    })
  }
  console.log()

  // 4. Check total resources across all workspaces
  console.log('📊 Overall statistics...')
  const { data: allResources, error: allResourcesError } = await supabaseAdmin
    .from('resource')
    .select('id, space_id, title, type, source')

  if (allResourcesError) {
    console.error('❌ Error fetching all resources:', allResourcesError)
  } else {
    console.log(`✅ Total resources in database: ${allResources?.length || 0}`)
    
    if (allResources && allResources.length > 0) {
      // Group by workspace
      const byWorkspace = allResources.reduce((acc: any, r: any) => {
        acc[r.space_id] = (acc[r.space_id] || 0) + 1
        return acc
      }, {})
      
      console.log(`   Resources by workspace:`)
      for (const [spaceId, count] of Object.entries(byWorkspace)) {
        const space = spaces?.find(s => s.id === spaceId)
        const spaceName = space?.name || 'Unknown'
        console.log(`     ${spaceName} (${spaceId}): ${count}`)
      }
      
      // Group by source
      const bySource = allResources.reduce((acc: any, r: any) => {
        acc[r.source] = (acc[r.source] || 0) + 1
        return acc
      }, {})
      console.log(`   Resources by source:`, bySource)
    }
  }
  console.log()

  // 5. Check if FTS function exists and works
  console.log('🔍 Testing FTS search function...')
  try {
    const testQuery = 'summons'
    const { data: ftsResults, error: ftsError } = await (supabaseAdmin as any).rpc('search_resources_fts', {
      search_query: testQuery,
      target_space_id: null, // Search all spaces
      limit_count: 5,
      offset_count: 0,
      target_user_id: null
    })

    if (ftsError) {
      console.error(`❌ FTS search error for query "${testQuery}":`, ftsError)
    } else {
      console.log(`✅ FTS search for "${testQuery}" returned ${ftsResults?.length || 0} results`)
      if (ftsResults && ftsResults.length > 0) {
        ftsResults.forEach((r: any, i: number) => {
          console.log(`   ${i + 1}. ${r.title} (rank: ${r.rank}, space: ${r.space_id})`)
        })
      }
    }
  } catch (err) {
    console.error('❌ FTS function test failed:', err)
  }
  console.log()

  // 6. Check resource embeddings
  console.log('🧬 Checking resource embeddings...')
  try {
    const { data: embeddings, error: embeddingsError } = await supabaseAdmin
      .from('resource_embedding')
      .select('resource_id')
      .limit(10)

    if (embeddingsError) {
      console.error('❌ Error checking embeddings:', embeddingsError)
      console.log('   (This might be expected if embeddings table doesn\'t exist)')
    } else {
      const { count } = await supabaseAdmin
        .from('resource_embedding')
        .select('*', { count: 'exact', head: true })
      
      console.log(`✅ Found ${count || 0} resource embeddings`)
    }
  } catch (err) {
    console.error('❌ Embedding check failed:', err)
  }
  console.log()

  console.log('✅ Diagnosis complete!')
}

diagnoseDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Diagnosis failed:', err)
    process.exit(1)
  })


