/**
 * Admin API: Sync Poll Responses to Airtable
 * 
 * Retroactively syncs all poll responses to Airtable with correct field names
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { syncPollResponsesToAirtable, syncAllPollResponsesToAirtable } from '@/lib/polls/retroactiveSync'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Allow auth via Clerk OR secret key (for one-time sync)
    const { userId } = await auth()
    const body = await request.json()
    const { pollId, secretKey } = body
    
    // Check secret key (set in env as SYNC_POLL_SECRET_KEY)
    const validSecret = process.env.SYNC_POLL_SECRET_KEY && secretKey === process.env.SYNC_POLL_SECRET_KEY
    
    if (!userId && !validSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }


    if (pollId) {
      // Sync specific poll
      console.log(`[Admin API] Syncing poll responses for poll: ${pollId}`)
      const result = await syncPollResponsesToAirtable(pollId)
      
      return NextResponse.json({
        success: true,
        pollId,
        synced: result.synced,
        errors: result.errors,
        errorsList: result.errorsList
      })
    } else {
      // Sync all polls
      console.log(`[Admin API] Syncing all poll responses`)
      const result = await syncAllPollResponsesToAirtable()
      
      return NextResponse.json({
        success: true,
        totalSynced: result.totalSynced,
        totalErrors: result.totalErrors,
        pollResults: result.pollResults
      })
    }
  } catch (error) {
    console.error('[Admin API] Error syncing poll responses:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

