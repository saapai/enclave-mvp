import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getGoogleTokens, refreshTokensIfNeeded } from '@/lib/google-docs'
import { 
  fetchCalendarEvents, 
  formatCalendarEvent,
  storeCalendarEvents,
  deleteEventsForSource
} from '@/lib/google-calendar'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

// Auto-sync all connected calendars
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log(`[Auto-Sync] Starting calendar auto-sync for user ${userId}`)

    // Get user's Google tokens
    const googleAccount = await getGoogleTokens(userId)
    if (!googleAccount) {
      return NextResponse.json({ 
        success: true,
        synced: 0,
        message: 'No Google account connected'
      })
    }

    // Refresh tokens if needed
    let tokens
    try {
      tokens = await refreshTokensIfNeeded({
        access_token: googleAccount.access_token,
        refresh_token: googleAccount.refresh_token,
        expiry_date: new Date(googleAccount.token_expiry).getTime()
      })
    } catch (tokenError) {
      console.error('[Auto-Sync] Token refresh failed:', tokenError)
      return NextResponse.json({ 
        success: false,
        error: 'Google account needs re-authentication'
      })
    }

    // Get all connected calendar sources for this user
    const { data: sources, error: sourcesError } = await supabase
      .from('sources_google_calendar')
      .select('*')
      .eq('added_by', userId)

    if (sourcesError) {
      console.error('[Auto-Sync] Failed to fetch calendar sources:', sourcesError)
      return NextResponse.json({ error: 'Failed to fetch calendar sources' }, { status: 500 })
    }

    if (!sources || sources.length === 0) {
      return NextResponse.json({ 
        success: true,
        synced: 0,
        message: 'No calendars connected'
      })
    }

    console.log(`[Auto-Sync] Found ${sources.length} calendar(s) to sync`)

    let totalEventsSynced = 0
    const syncResults = []

    // Sync each calendar
    for (const source of sources) {
      try {
        const now = new Date()
        const future = new Date()
        future.setDate(future.getDate() + 90) // Next 90 days

        // Fetch latest events from Google Calendar
        const events = await fetchCalendarEvents(tokens, source.google_calendar_id, now, future)

        // Format events
        const formattedEvents = events.map(event => 
          formatCalendarEvent(event, source.calendar_name)
        )

        // Delete old events for this source
        await deleteEventsForSource(source.space_id, source.id)

        // Store new events
        await storeCalendarEvents(source.space_id, source.id, formattedEvents)

        totalEventsSynced += formattedEvents.length

        syncResults.push({
          calendarId: source.google_calendar_id,
          calendarName: source.calendar_name,
          eventsCount: formattedEvents.length
        })

        console.log(`[Auto-Sync] ✓ Synced ${formattedEvents.length} events from ${source.calendar_name}`)
      } catch (error: any) {
        console.error(`[Auto-Sync] Failed to sync calendar ${source.calendar_name}:`, error)
        syncResults.push({
          calendarId: source.google_calendar_id,
          calendarName: source.calendar_name,
          error: error.message
        })
      }
    }

    return NextResponse.json({
      success: true,
      synced: syncResults.length,
      totalEvents: totalEventsSynced,
      calendars: syncResults
    })

  } catch (error: any) {
    console.error('[Auto-Sync] Calendar auto-sync error:', error)
    return NextResponse.json({ 
      error: 'Failed to auto-sync calendars',
      details: error.message
    }, { status: 500 })
  }
}

