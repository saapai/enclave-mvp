import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getGoogleTokens, refreshTokensIfNeeded } from '@/lib/google-docs'
import { 
  fetchCalendarEvents, 
  formatCalendarEvent,
  getCalendarSource,
  storeCalendarEvents,
  createResourcesForCalendarEvents
} from '@/lib/google-calendar'
import { apiCache, CACHE_KEYS } from '@/lib/cache'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { sourceId, daysAhead = 90 } = body

    if (!sourceId) {
      return NextResponse.json({ error: 'Source ID is required' }, { status: 400 })
    }

    // Get calendar source
    const source = await getCalendarSource(sourceId)

    // Get user's Google tokens
    const googleAccount = await getGoogleTokens(userId)
    if (!googleAccount) {
      return NextResponse.json({ 
        error: 'Google account not connected',
        needsOAuth: true
      }, { status: 400 })
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
      console.error('Token refresh failed:', tokenError)
      return NextResponse.json({ 
        error: 'Google account needs re-authentication',
        needsOAuth: true
      }, { status: 400 })
    }

    // Fetch latest calendar events (include past 7 days)
    const past = new Date()
    past.setDate(past.getDate() - 7) // Include events from 7 days ago
    const future = new Date()
    future.setDate(future.getDate() + daysAhead)

    const events = await fetchCalendarEvents(tokens, source.calendar_id, past, future)

    // Format events
    const formattedEvents = events.map(event => 
      formatCalendarEvent(event, source.calendar_name)
    )

    // Store updated events
    await storeCalendarEvents(source.space_id, sourceId, formattedEvents)

    // Update resource entries
    await createResourcesForCalendarEvents(source.space_id, formattedEvents)

    // Clear resources cache
    apiCache.delete(CACHE_KEYS.RESOURCES)

    return NextResponse.json({
      success: true,
      eventsCount: formattedEvents.length,
      calendarName: source.calendar_name
    })

  } catch (error: any) {
    console.error('Calendar refresh error:', error)
    return NextResponse.json({ 
      error: 'Failed to refresh calendar',
      details: error.message
    }, { status: 500 })
  }
}

