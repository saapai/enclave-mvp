/**
 * One-Time Poll Response Sync Endpoint
 * 
 * PUBLIC endpoint to sync all poll responses to Airtable.
 * This is a temporary endpoint for retroactive sync.
 * 
 * DISABLE THIS AFTER USE by setting ENABLE_SYNC_ONCE=false in env or deleting this file.
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncAllPollResponsesToAirtable, syncMostRecentPollToAirtable } from '@/lib/polls/retroactiveSync'

export const dynamic = 'force-dynamic'

// Simple in-memory flag to prevent multiple runs (resets on deploy)
let hasRun = false

export async function GET(request: NextRequest) {
  try {
    // Check if endpoint is enabled
    const isEnabled = process.env.ENABLE_SYNC_ONCE !== 'false'
    
    if (!isEnabled) {
      return NextResponse.json({ 
        error: 'This endpoint has been disabled',
        message: 'Set ENABLE_SYNC_ONCE=true in env to enable (or delete this file after use)'
      }, { status: 403 })
    }
    
    // Check query params for sync type
    const { searchParams } = new URL(request.url)
    const syncType = searchParams.get('type') // 'recent' or 'all' (default)
    
    if (syncType === 'recent') {
      // Sync just the most recent poll (regardless of status)
      console.log('[One-Time Sync] Syncing most recent poll...')
      const result = await syncMostRecentPollToAirtable()
      
      return NextResponse.json({
        success: true,
        message: 'Most recent poll synced',
        pollId: result.pollId,
        question: result.question?.substring(0, 50) + '...',
        synced: result.synced,
        errors: result.errors,
        errorsList: result.errorsList
      })
    }
    
    // Check if already run (simple in-memory check - will reset on deploy)
    if (hasRun) {
      return NextResponse.json({ 
        error: 'Sync has already been run',
        message: 'This is a one-time sync endpoint. Redeploy or restart to reset the flag. Or use ?type=recent to sync just the most recent poll.'
      }, { status: 403 })
    }
    
    // Run the sync for all polls
    console.log('[One-Time Sync] Starting retroactive sync of all poll responses...')
    const result = await syncAllPollResponsesToAirtable()
    
    // Mark as run
    hasRun = true
    
    console.log('[One-Time Sync] Completed:', {
      totalSynced: result.totalSynced,
      totalErrors: result.totalErrors,
      pollCount: result.pollResults.length
    })
    
    return NextResponse.json({
      success: true,
      message: 'Sync completed successfully',
      totalSynced: result.totalSynced,
      totalErrors: result.totalErrors,
      pollResults: result.pollResults.map(p => ({
        question: p.question.substring(0, 50) + '...',
        synced: p.synced,
        errors: p.errors
      }))
    })
  } catch (error) {
    console.error('[One-Time Sync] Error:', error)
    return NextResponse.json(
      { 
        error: 'Sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Same as GET, but allow POST for easier calling
  return GET(request)
}

