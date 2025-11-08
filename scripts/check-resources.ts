import { supabaseAdmin } from '../src/lib/supabase'

async function checkResources() {
  console.log('Checking resources in workspaces...\n')
  
  const workspaceIds = [
    '43526ef2-8efb-40b7-81db-3e22ecc76432',
    'cede7e05-e04b-42bf-83fc-dd0a075bcd85',
    'e4fcb3d4-1222-46cc-ace7-f5e9852ca9c5',
    'aac9ccee-65c9-471e-be81-37bd4c9bd86f'
  ]
  
  for (const wsId of workspaceIds) {
    const { data, error } = await supabaseAdmin!
      .from('resource')
      .select('id, title, type, created_at')
      .eq('space_id', wsId)
      .limit(10)
    
    if (error) {
      console.error(`Error querying workspace ${wsId}:`, error)
      continue
    }
    
    console.log(`\nWorkspace ${wsId}:`)
    console.log(`  Total resources: ${data?.length || 0}`)
    if (data && data.length > 0) {
      console.log('  Sample resources:')
      data.forEach((r: any) => {
        console.log(`    - ${r.title} (${r.type})`)
      })
    }
  }
  
  // Check for "big little" specifically
  console.log('\n\nSearching for "big little" across all workspaces...')
  const { data: bigLittleResults } = await supabaseAdmin!
    .from('resource')
    .select('id, title, space_id, body')
    .in('space_id', workspaceIds)
    .or('title.ilike.%big%little%,body.ilike.%big%little%')
    .limit(5)
  
  console.log(`Found ${bigLittleResults?.length || 0} results for "big little"`)
  if (bigLittleResults && bigLittleResults.length > 0) {
    bigLittleResults.forEach((r: any) => {
      console.log(`  - ${r.title} in workspace ${r.space_id}`)
    })
  }
}

checkResources().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
