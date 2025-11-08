import { supabaseAdmin } from '../src/lib/supabase'

async function diagnoseWorkspaces() {
  console.log('=== WORKSPACE DIAGNOSIS ===\n')
  
  const workspaceIds = [
    '43526ef2-8efb-40b7-81db-3e22ecc76432',
    'cede7e05-e04b-42bf-83fc-dd0a075bcd85',
    'e4fcb3d4-1222-46cc-ace7-f5e9852ca9c5',
    'aac9ccee-65c9-471e-be81-37bd4c9bd86f'
  ]
  
  // 1. Check if workspaces exist in space table
  console.log('1. Checking space table...')
  const { data: spaces, error: spaceError } = await supabaseAdmin!
    .from('space')
    .select('*')
    .in('id', workspaceIds)
  
  if (spaceError) {
    console.error('Error querying spaces:', spaceError)
  } else {
    console.log(`Found ${spaces?.length || 0} workspaces in space table:`)
    spaces?.forEach((s: any) => {
      console.log(`  - ${s.name} (${s.id})`)
      console.log(`    created_by: ${s.created_by}`)
      console.log(`    created_at: ${s.created_at}`)
      console.log(`    is_personal: ${s.is_personal}`)
    })
  }
  
  // 2. Check resources in each workspace
  console.log('\n2. Checking resources in each workspace...')
  for (const wsId of workspaceIds) {
    const { data: resources, error: resError } = await supabaseAdmin!
      .from('resource')
      .select('id, title, type, created_at, created_by')
      .eq('space_id', wsId)
      .limit(5)
    
    if (resError) {
      console.error(`  Error for ${wsId}:`, resError)
    } else {
      console.log(`  Workspace ${wsId}: ${resources?.length || 0} resources`)
      resources?.forEach((r: any) => {
        console.log(`    - ${r.title} (${r.type}) by ${r.created_by}`)
      })
    }
  }
  
  // 3. Check app_user associations
  console.log('\n3. Checking app_user associations...')
  const { data: appUsers, error: appUserError } = await supabaseAdmin!
    .from('app_user')
    .select('*')
    .in('space_id', workspaceIds)
  
  if (appUserError) {
    console.error('Error querying app_user:', appUserError)
  } else {
    console.log(`Found ${appUsers?.length || 0} app_user associations:`)
    appUsers?.forEach((u: any) => {
      console.log(`  - User ${u.clerk_user_id} -> Workspace ${u.space_id}`)
      console.log(`    phone: ${u.phone}`)
    })
  }
  
  // 4. Check for "SEP" workspaces that might be missing
  console.log('\n4. Searching for ALL workspaces with "SEP" in name...')
  const { data: allSepSpaces, error: sepError } = await supabaseAdmin!
    .from('space')
    .select('*')
    .ilike('name', '%SEP%')
  
  if (sepError) {
    console.error('Error searching for SEP workspaces:', sepError)
  } else {
    console.log(`Found ${allSepSpaces?.length || 0} SEP workspaces total:`)
    allSepSpaces?.forEach((s: any) => {
      console.log(`  - ${s.name} (${s.id})`)
      console.log(`    created_by: ${s.created_by}`)
      console.log(`    in our list: ${workspaceIds.includes(s.id) ? 'YES' : 'NO'}`)
    })
  }
  
  // 5. Check for orphaned resources (resources with invalid space_id)
  console.log('\n5. Checking for orphaned resources...')
  const { data: allResources, error: allResError } = await supabaseAdmin!
    .from('resource')
    .select('id, title, space_id')
    .limit(100)
  
  if (allResError) {
    console.error('Error querying all resources:', allResError)
  } else {
    const orphaned = allResources?.filter((r: any) => 
      !workspaceIds.includes(r.space_id) && r.space_id !== '00000000-0000-0000-0000-000000000000'
    )
    console.log(`Found ${orphaned?.length || 0} resources in non-SEP workspaces`)
    if (orphaned && orphaned.length > 0) {
      console.log('Sample orphaned resources:')
      orphaned.slice(0, 5).forEach((r: any) => {
        console.log(`  - ${r.title} in workspace ${r.space_id}`)
      })
    }
  }
  
  console.log('\n=== DIAGNOSIS COMPLETE ===')
}

diagnoseWorkspaces().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
