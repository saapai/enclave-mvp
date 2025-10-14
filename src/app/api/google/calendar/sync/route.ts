import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getGoogleTokens, refreshTokensIfNeeded } from '@/lib/google-docs'
import { 
  fetchCalendarEvents, 
  formatCalendarEvent,
  storeCalendarSource,
  storeCalendarEvents,
  createResourcesForCalendarEvents
} from '@/lib/google-calendar'
import { apiCache, CACHE_KEYS } from '@/lib/cache'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      calendarId, 
      calendarName, 
      calendarDescription = '',
      isPrimary = false,
      spaceIds = [DEFAULT_SPACE_ID],
      daysAhead = 90  // Sync events for next 90 days by default
    } = body

    if (!calendarId) {
      return NextResponse.json({ error: 'Calendar ID is required' }, { status: 400 })
    }

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

    // Fetch calendar events
    const now = new Date()
    const future = new Date()
    future.setDate(future.getDate() + daysAhead)

    console.log('[Calendar Sync] Fetching events for calendar:', calendarId)
    const events = await fetchCalendarEvents(tokens, calendarId, now, future)
    console.log('[Calendar Sync] Fetched events count:', events.length)

    // Format events
    const formattedEvents = events.map(event => 
      formatCalendarEvent(event, calendarName || calendarId)
    )
    console.log('[Calendar Sync] Formatted events count:', formattedEvents.length)

    // Store calendar source and events for each space
    const sources = []
    let totalEventsStored = 0

    for (const spaceId of spaceIds) {
      // Store calendar source
      const source = await storeCalendarSource(
        spaceId,
        calendarId,
        calendarName || calendarId,
        calendarDescription,
        isPrimary,
        userId
      )
      sources.push(source)

      // Store events with embeddings
      await storeCalendarEvents(spaceId, source.id, formattedEvents)
      totalEventsStored += formattedEvents.length

      // Create resource entries for events
      await createResourcesForCalendarEvents(spaceId, formattedEvents)
    }

    // Clear resources cache
    apiCache.delete(CACHE_KEYS.RESOURCES)

    return NextResponse.json({
      success: true,
      source: {
        id: sources[0].id,
        calendarId,
        calendarName: calendarName || calendarId,
        eventsCount: formattedEvents.length,
        spacesCount: spaceIds.length,
        daysAhead
      }
    })

  } catch (error: any) {
    console.error('[Calendar Sync] Full error:', error)
    console.error('[Calendar Sync] Error message:', error.message)
    console.error('[Calendar Sync] Error code:', error.code)
    console.error('[Calendar Sync] Error stack:', error.stack)
    
    // Check for duplicate key error
    if (error?.code === '23505' && error?.message?.includes('duplicate key')) {
      return NextResponse.json({ 
        error: 'This calendar is already connected',
        details: 'The calendar has already been added to your resources.',
        isAlreadyConnected: true
      }, { status: 409 })
    }
    
    return NextResponse.json({ 
      error: 'Failed to sync calendar',
      details: error.message,
      errorCode: error.code,
      errorName: error.name
    }, { status: 500 })
  }
}

