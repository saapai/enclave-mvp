/**
 * Event Consolidator Worker
 * Nightly job that consolidates events from multiple sources
 * Runs entity extraction on all resources and updates knowledge graph
 */

import { supabaseAdmin } from '../lib/supabase'
import { processResource } from '../lib/entity-extractor'

// ============================================================================
// CONSOLIDATION LOGIC
// ============================================================================

/**
 * Consolidate events from all resources in a workspace
 */
export async function consolidateWorkspaceEvents(
  spaceId: string
): Promise<{ processed: number; saved: number; failed: number }> {
  console.log(`[Event Consolidator] Starting consolidation for workspace ${spaceId}`)

  // Get all resources in workspace
  const { data: resources, error } = await supabaseAdmin
    .from('resource')
    .select('id, title, body, source, updated_at')
    .eq('space_id', spaceId)
    .order('updated_at', { ascending: false })

  if (error || !resources) {
    console.error('[Event Consolidator] Error fetching resources:', error)
    return { processed: 0, saved: 0, failed: 0 }
  }

  console.log(`[Event Consolidator] Found ${resources.length} resources to process`)

  let totalSaved = 0
  let totalFailed = 0
  let processed = 0

  // Process each resource
  for (const resource of resources) {
    if (!resource.body || resource.body.length < 50) {
      console.log(`[Event Consolidator] Skipping ${resource.title} - too short`)
      continue
    }

    try {
      const result = await processResource(
        resource.id,
        resource.body,
        spaceId
      )

      totalSaved += result.saved
      totalFailed += result.failed
      processed++

      // Rate limit: wait 1 second between API calls
      await new Promise(resolve => setTimeout(resolve, 1000))

    } catch (error) {
      console.error(`[Event Consolidator] Error processing ${resource.title}:`, error)
      totalFailed++
    }
  }

  console.log(`[Event Consolidator] Consolidation complete:`)
  console.log(`  - Processed: ${processed} resources`)
  console.log(`  - Saved: ${totalSaved} entities`)
  console.log(`  - Failed: ${totalFailed} entities`)

  return { processed, saved: totalSaved, failed: totalFailed }
}

/**
 * Consolidate events from Google Docs chunks
 */
export async function consolidateGoogleDocsEvents(
  spaceId: string
): Promise<{ processed: number; saved: number; failed: number }> {
  console.log(`[Event Consolidator] Starting Google Docs consolidation for workspace ${spaceId}`)

  // Get all Google Doc chunks in workspace
  const { data: chunks, error } = await supabaseAdmin
    .from('google_doc_chunks')
    .select('id, source_id, text, heading_path')
    .eq('space_id', spaceId)
    .order('chunk_index', { ascending: true })

  if (error || !chunks) {
    console.error('[Event Consolidator] Error fetching Google Docs chunks:', error)
    return { processed: 0, saved: 0, failed: 0 }
  }

  console.log(`[Event Consolidator] Found ${chunks.length} Google Docs chunks to process`)

  let totalSaved = 0
  let totalFailed = 0
  let processed = 0

  // Group chunks by source_id
  const chunksBySource = new Map<string, typeof chunks>()
  for (const chunk of chunks) {
    if (!chunksBySource.has(chunk.source_id)) {
      chunksBySource.set(chunk.source_id, [])
    }
    chunksBySource.get(chunk.source_id)!.push(chunk)
  }

  // Process each document
  for (const [sourceId, docChunks] of chunksBySource.entries()) {
    // Combine chunks into full text
    const fullText = docChunks.map(c => c.text).join('\n\n')

    try {
      const result = await processResource(
        sourceId,
        fullText,
        spaceId
      )

      totalSaved += result.saved
      totalFailed += result.failed
      processed++

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000))

    } catch (error) {
      console.error(`[Event Consolidator] Error processing Google Doc ${sourceId}:`, error)
      totalFailed++
    }
  }

  console.log(`[Event Consolidator] Google Docs consolidation complete:`)
  console.log(`  - Processed: ${processed} documents`)
  console.log(`  - Saved: ${totalSaved} entities`)
  console.log(`  - Failed: ${totalFailed} entities`)

  return { processed, saved: totalSaved, failed: totalFailed }
}

/**
 * Consolidate events from Slack messages
 */
export async function consolidateSlackEvents(
  spaceId: string
): Promise<{ processed: number; saved: number; failed: number }> {
  console.log(`[Event Consolidator] Starting Slack consolidation for workspace ${spaceId}`)

  // Get all Slack messages in workspace
  const { data: messages, error } = await supabaseAdmin
    .from('slack_message')
    .select('id, text, channel_name, thread_context')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false })
    .limit(1000) // Only recent messages

  if (error || !messages) {
    console.error('[Event Consolidator] Error fetching Slack messages:', error)
    return { processed: 0, saved: 0, failed: 0 }
  }

  console.log(`[Event Consolidator] Found ${messages.length} Slack messages to process`)

  let totalSaved = 0
  let totalFailed = 0
  let processed = 0

  // Process messages in batches of 10 (combine related messages)
  const batchSize = 10
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize)
    const combinedText = batch.map(m => 
      `[${m.channel_name}] ${m.text}${m.thread_context ? ' (Thread: ' + m.thread_context + ')' : ''}`
    ).join('\n\n')

    try {
      const result = await processResource(
        `slack_batch_${i}`,
        combinedText,
        spaceId
      )

      totalSaved += result.saved
      totalFailed += result.failed
      processed++

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000))

    } catch (error) {
      console.error(`[Event Consolidator] Error processing Slack batch ${i}:`, error)
      totalFailed++
    }
  }

  console.log(`[Event Consolidator] Slack consolidation complete:`)
  console.log(`  - Processed: ${processed} batches`)
  console.log(`  - Saved: ${totalSaved} entities`)
  console.log(`  - Failed: ${totalFailed} entities`)

  return { processed, saved: totalSaved, failed: totalFailed }
}

// ============================================================================
// MAIN CONSOLIDATOR
// ============================================================================

/**
 * Run full consolidation for all sources in a workspace
 */
export async function consolidateAllSources(
  spaceId: string
): Promise<{
  resources: { processed: number; saved: number; failed: number }
  googleDocs: { processed: number; saved: number; failed: number }
  slack: { processed: number; saved: number; failed: number }
}> {
  console.log(`[Event Consolidator] ========================================`)
  console.log(`[Event Consolidator] Starting full consolidation for workspace ${spaceId}`)
  console.log(`[Event Consolidator] ========================================`)

  const startTime = Date.now()

  // Consolidate from all sources
  const resources = await consolidateWorkspaceEvents(spaceId)
  const googleDocs = await consolidateGoogleDocsEvents(spaceId)
  const slack = await consolidateSlackEvents(spaceId)

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`[Event Consolidator] ========================================`)
  console.log(`[Event Consolidator] Full consolidation complete in ${duration}s`)
  console.log(`[Event Consolidator] Total saved: ${resources.saved + googleDocs.saved + slack.saved}`)
  console.log(`[Event Consolidator] Total failed: ${resources.failed + googleDocs.failed + slack.failed}`)
  console.log(`[Event Consolidator] ========================================`)

  return { resources, googleDocs, slack }
}

// ============================================================================
// CRON JOB ENTRY POINT
// ============================================================================

/**
 * Main entry point for cron job
 * Run nightly for all workspaces
 */
export async function runNightlyConsolidation(): Promise<void> {
  console.log(`[Event Consolidator] Starting nightly consolidation job`)

  // Get all workspaces
  const { data: spaces, error } = await supabaseAdmin
    .from('space')
    .select('id, name')
    .neq('id', '00000000-0000-0000-0000-000000000000') // Skip default space

  if (error || !spaces) {
    console.error('[Event Consolidator] Error fetching workspaces:', error)
    return
  }

  console.log(`[Event Consolidator] Found ${spaces.length} workspaces to consolidate`)

  // Process each workspace
  for (const space of spaces) {
    console.log(`[Event Consolidator] Processing workspace: ${space.name}`)
    
    try {
      await consolidateAllSources(space.id)
    } catch (error) {
      console.error(`[Event Consolidator] Error consolidating workspace ${space.name}:`, error)
    }

    // Wait between workspaces to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 5000))
  }

  console.log(`[Event Consolidator] Nightly consolidation job complete`)
}

// If run directly (not imported), execute the nightly job
if (require.main === module) {
  runNightlyConsolidation()
    .then(() => {
      console.log('Consolidation complete')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Consolidation failed:', error)
      process.exit(1)
    })
}

