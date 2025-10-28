/**
 * Alerts API
 * Manage proactive alerts and reminders
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createDeadlineAlert, createEventReminder } from '@/lib/deadline-detector'

export const dynamic = 'force-dynamic'

/**
 * GET /api/alerts?spaceId=xxx
 * List alerts for a workspace
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')
    const status = searchParams.get('status') || 'pending'

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId required' }, { status: 400 })
    }

    // Get alerts
    let query = supabaseAdmin
      .from('alert')
      .select('*')
      .eq('space_id', spaceId)
      .order('fire_at', { ascending: true })

    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: alerts, error } = await query

    if (error) {
      throw error
    }

    return NextResponse.json({ alerts: alerts || [] })

  } catch (error) {
    console.error('[Alerts API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/alerts
 * Create a new alert
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { spaceId, kind, fireAt, title, message, recipients } = body

    if (!spaceId || !kind || !fireAt || !title || !message || !recipients) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Create alert
    const { data, error } = await supabaseAdmin
      .from('alert')
      .insert({
        space_id: spaceId,
        kind,
        fire_at: fireAt,
        title,
        message,
        recipients
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ alert: data })

  } catch (error) {
    console.error('[Alerts API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/alerts/:id
 * Cancel an alert
 */
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const alertId = searchParams.get('id')

    if (!alertId) {
      return NextResponse.json({ error: 'Alert ID required' }, { status: 400 })
    }

    // Cancel alert
    await supabaseAdmin
      .rpc('cancel_alert', { alert_id_param: alertId })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('[Alerts API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

