/**
 * Internal Consolidation API
 * No auth required - use internal API key
 */

import { NextRequest, NextResponse } from 'next/server'
import { consolidateAllSources } from '@/workers/event-consolidator'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes

/**
 * POST /api/internal/consolidate
 * Trigger consolidation with API key
 */
export async function POST(request: NextRequest) {
  try {
    // Check internal API key
    const apiKey = request.headers.get('x-api-key')
    const expectedKey = process.env.INTERNAL_API_KEY
    
    if (!expectedKey || apiKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { spaceId } = await request.json()

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId required' }, { status: 400 })
    }

    console.log(`[Internal API] Starting consolidation for workspace ${spaceId}`)

    // Run consolidation
    const result = await consolidateAllSources(spaceId)

    return NextResponse.json({
      success: true,
      result
    })

  } catch (error: any) {
    console.error('[Internal API] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

