/**
 * Script to sync all poll responses to Airtable
 * Run: npx tsx scripts/sync-poll-responses.ts
 */

import { syncAllPollResponsesToAirtable } from '../src/lib/polls/retroactiveSync'

async function main() {
  console.log('Starting retroactive sync of all poll responses to Airtable...')
  
  const result = await syncAllPollResponsesToAirtable()
  
  console.log('\n=== Sync Complete ===')
  console.log(`Total synced: ${result.totalSynced}`)
  console.log(`Total errors: ${result.totalErrors}`)
  console.log('\nResults by poll:')
  
  for (const pollResult of result.pollResults) {
    console.log(`  - "${pollResult.question.substring(0, 50)}..."`)
    console.log(`    Synced: ${pollResult.synced}, Errors: ${pollResult.errors}`)
  }
  
  if (result.totalErrors > 0) {
    console.error('\n⚠️ Some errors occurred. Check logs above for details.')
    process.exit(1)
  } else {
    console.log('\n✓ All poll responses synced successfully!')
    process.exit(0)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

