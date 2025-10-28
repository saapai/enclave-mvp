/**
 * Telemetry API
 * View analytics and performance metrics
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getTelemetrySummary, getSlowQueries, getLowConfidenceQueries } from '@/lib/telemetry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/telemetry?spaceId=xxx&type=summary|slow|low_confidence
 * Get telemetry data
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')
    const type = searchParams.get('type') || 'summary'

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId required' }, { status: 400 })
    }

    if (type === 'summary') {
      // Get summary for last 30 days
      const endDate = new Date()
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 30)

      const summary = await getTelemetrySummary(spaceId, startDate, endDate)
      return NextResponse.json({ summary })

    } else if (type === 'slow') {
      // Get slow queries
      const threshold = parseInt(searchParams.get('threshold') || '2000')
      const slowQueries = await getSlowQueries(spaceId, threshold)
      return NextResponse.json({ slowQueries })

    } else if (type === 'low_confidence') {
      // Get low confidence queries
      const threshold = parseFloat(searchParams.get('threshold') || '0.5')
      const lowConfidenceQueries = await getLowConfidenceQueries(spaceId, threshold)
      return NextResponse.json({ lowConfidenceQueries })

    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

  } catch (error) {
    console.error('[Telemetry API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

