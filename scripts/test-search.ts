import { supabaseAdmin } from '../src/lib/supabase'

async function main() {
  if (!supabaseAdmin) {
    console.error('supabaseAdmin client not available. Did you load .env.local?')
    process.exit(1)
  }

  // Lazy-import search module to avoid circular deps during script load
  const searchModule: any = await import('../src/lib/search')
  const searchHelpers = searchModule.default ?? searchModule
  const searchResources = searchHelpers.searchResources as typeof searchModule.searchResources

  const workspaceId = 'aac9ccee-65c9-471e-be81-37bd4c9bd86f'
  const queries = ['When is active meeting', 'When is big little', 'When is ae summons', 'When is futsal']

  for (const query of queries) {
    console.log(`\n=== ${query} ===`)

    const { data, error } = await (supabaseAdmin as any).rpc('search_resources_fts', {
      search_query: query,
      target_space_id: workspaceId,
      limit_count: 5,
      offset_count: 0
    })

    if (error) {
      console.error('RPC error:', error)
    } else {
      console.log('RPC rows:', (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        rank: row.rank
      })))
    }

    const fallback = await searchResources(query, workspaceId, {}, { limit: 5 })
    console.log('Fallback rows:', fallback.map((row: any) => ({
      id: row.id,
      title: row.title,
      score: row.score
    })))
  }
}

main().catch(err => {
  console.error('Diagnostic failed:', err)
  process.exit(1)
})

