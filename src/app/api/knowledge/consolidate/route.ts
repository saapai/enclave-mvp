/**
 * Knowledge Graph Consolidation API
 * Manually trigger entity extraction and consolidation
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { consolidateAllSources } from '@/workers/event-consolidator'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * POST /api/knowledge/consolidate
 * Trigger consolidation for a workspace
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { spaceId } = await request.json()

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId required' }, { status: 400 })
    }

    // Verify user has access to this workspace
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const clerkUser = await client.users.getUser(userId)
    const userEmail = clerkUser.emailAddresses[0]?.emailAddress

    const { data: membership } = await supabaseAdmin
      .from('app_user')
      .select('*')
      .eq('email', userEmail)
      .eq('space_id', spaceId)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    console.log(`[Knowledge API] Starting consolidation for workspace ${spaceId}`)

    // Run consolidation
    const result = await consolidateAllSources(spaceId)

    return NextResponse.json({
      success: true,
      result
    })

  } catch (error) {
    console.error('[Knowledge API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/knowledge/consolidate?spaceId=xxx
 * Get consolidation status and stats
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId required' }, { status: 400 })
    }

    // Get entity counts
    const { data: events } = await supabaseAdmin
      .from('event')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)

    const { data: policies } = await supabaseAdmin
      .from('policy')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)

    const { data: people } = await supabaseAdmin
      .from('person')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)

    const { data: facts } = await supabaseAdmin
      .from('fact')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)

    // Get recent events
    const { data: recentEvents } = await supabaseAdmin
      .from('event')
      .select('name, start_at, location, confidence, last_seen')
      .eq('space_id', spaceId)
      .order('last_seen', { ascending: false })
      .limit(10)

    return NextResponse.json({
      stats: {
        events: events?.length || 0,
        policies: policies?.length || 0,
        people: people?.length || 0,
        facts: facts?.length || 0
      },
      recentEvents: recentEvents || []
    })

  } catch (error) {
    console.error('[Knowledge API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

