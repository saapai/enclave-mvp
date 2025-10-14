import { google } from 'googleapis'
import { supabaseAdmin } from '@/lib/supabase'
import { embedText } from '@/lib/embeddings'
import { createOAuthClient } from '@/lib/google-docs'

// Use admin client to bypass RLS since user auth is validated at API route level
const supabase = supabaseAdmin!

// Create authenticated Google Calendar client
export function createCalendarClient(tokens: any) {
  const auth = createOAuthClient()
  auth.setCredentials(tokens)
  return google.calendar({ version: 'v3', auth })
}

// Fetch calendar list
export async function listCalendars(tokens: any) {
  try {
    const calendar = createCalendarClient(tokens)
    
    console.log('Making calendar list API call...')
    const response = await calendar.calendarList.list({
      minAccessRole: 'reader',
      showHidden: false,
      showDeleted: false
    })

    console.log('Calendar list response:', response.data.items?.length || 0, 'calendars')
    
    if (response.data.items && response.data.items.length > 0) {
      console.log('Sample calendar:', response.data.items[0].summary)
    } else {
      console.warn('No calendars in response - check OAuth scopes')
    }
    
    return response.data.items || []
  } catch (error: any) {
    console.error('Calendar list API error:', error.message)
    if (error.code === 403) {
      console.error('Permission denied - Calendar API may not be enabled or scope not granted')
    }
    throw error
  }
}

// Fetch events from a calendar
export async function fetchCalendarEvents(
  tokens: any,
  calendarId: string,
  timeMin?: Date,
  timeMax?: Date,
  maxResults = 250
) {
  try {
    const calendar = createCalendarClient(tokens)
    
    console.log('[Calendar Events] Fetching from calendar:', calendarId)
    console.log('[Calendar Events] Time range:', timeMin?.toISOString(), '-', timeMax?.toISOString())
    
    const response = await calendar.events.list({
      calendarId,
      timeMin: (timeMin || new Date()).toISOString(),
      timeMax: timeMax?.toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    })

    console.log('[Calendar Events] Fetched items:', response.data.items?.length || 0)
    return response.data.items || []
  } catch (error: any) {
    console.error('[Calendar Events] Error fetching events:', error)
    console.error('[Calendar Events] Error details:', {
      message: error.message,
      code: error.code,
      errors: error.errors
    })
    throw error
  }
}

// Format calendar event for storage
export function formatCalendarEvent(event: any, calendarName: string) {
  const start = event.start?.dateTime || event.start?.date
  const end = event.end?.dateTime || event.end?.date
  const startTimezone = event.start?.timeZone || null
  const endTimezone = event.end?.timeZone || null
  const isAllDay = !event.start?.dateTime

  // Log for debugging timezone issues
  console.log(`[Calendar Format] Event: ${event.summary}`)
  console.log(`[Calendar Format] Raw event.start:`, JSON.stringify(event.start))
  console.log(`[Calendar Format] Raw event.end:`, JSON.stringify(event.end))
  console.log(`[Calendar Format] Extracted start: ${start}, timezone: ${startTimezone}`)
  console.log(`[Calendar Format] Extracted end: ${end}, timezone: ${endTimezone}`)

  // Build a rich description for embedding
  const parts = [
    `Event: ${event.summary || 'Untitled Event'}`,
    calendarName ? `Calendar: ${calendarName}` : '',
    event.description ? `Description: ${event.description}` : '',
    event.location ? `Location: ${event.location}` : '',
    event.attendees?.length ? `Attendees: ${event.attendees.map((a: any) => a.email).join(', ')}` : '',
    start ? `Start: ${new Date(start).toLocaleString()}` : '',
    end ? `End: ${new Date(end).toLocaleString()}` : ''
  ]

  const embeddingText = parts.filter(Boolean).join('\n')

  return {
    eventId: event.id,
    summary: event.summary || 'Untitled Event',
    description: event.description || '',
    location: event.location || '',
    start,
    end,
    startTimezone,
    endTimezone,
    isAllDay,
    attendees: event.attendees || [],
    embeddingText,
    htmlLink: event.htmlLink,
    status: event.status,
    organizer: event.organizer,
    recurringEventId: event.recurringEventId
  }
}

// Store calendar source
export async function storeCalendarSource(
  spaceId: string,
  calendarId: string,
  calendarName: string,
  calendarDescription: string,
  isPrimary: boolean,
  addedBy: string
) {
  const { data, error } = await supabase
    .from('sources_google_calendar')
    .upsert({
      space_id: spaceId,
      calendar_id: calendarId,
      calendar_name: calendarName,
      calendar_description: calendarDescription,
      is_primary: isPrimary,
      added_by: addedBy,
      last_synced: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'space_id,calendar_id'
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Delete events for a calendar source
export async function deleteEventsForSource(spaceId: string, sourceId: string) {
  const { error } = await supabase
    .from('calendar_events')
    .delete()
    .eq('space_id', spaceId)
    .eq('source_id', sourceId)

  if (error) throw error
}

// Store calendar events with embeddings
export async function storeCalendarEvents(
  spaceId: string,
  sourceId: string,
  events: any[]
) {
  // Delete old events for this source
  await deleteEventsForSource(spaceId, sourceId)

  if (events.length === 0) return

  // Generate embeddings for all events
  const eventsWithEmbeddings = await Promise.all(
    events.map(async (event) => {
      const embedding = await embedText(event.embeddingText)
      return {
        space_id: spaceId,
        source_id: sourceId,
        event_id: event.eventId,
        summary: event.summary,
        description: event.description,
        location: event.location,
        start_time: event.start,
        end_time: event.end,
        start_timezone: event.startTimezone,
        end_timezone: event.endTimezone,
        is_all_day: event.isAllDay,
        attendees: event.attendees,
        html_link: event.htmlLink,
        embedding: embedding
      }
    })
  )

  const { data, error } = await supabase
    .from('calendar_events')
    .insert(eventsWithEmbeddings)

  if (error) throw error
  return data
}

// Get calendar source
export async function getCalendarSource(sourceId: string) {
  const { data, error } = await supabase
    .from('sources_google_calendar')
    .select('*')
    .eq('id', sourceId)
    .single()

  if (error) throw error
  return data
}

// List all calendar sources for a user
export async function listCalendarSources(userId: string) {
  const { data, error } = await supabase
    .from('sources_google_calendar')
    .select('*')
    .eq('added_by', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

// Delete calendar source
export async function deleteCalendarSource(sourceId: string) {
  const { error } = await supabase
    .from('sources_google_calendar')
    .delete()
    .eq('id', sourceId)

  if (error) throw error
}

// Create resource entries for calendar events
export async function createResourcesForCalendarEvents(
  spaceId: string,
  events: any[]
) {
  const resources = events.map(event => ({
    space_id: spaceId,
    type: 'event' as const,
    title: event.summary,
    body: event.description,
    url: event.htmlLink,
    source: 'gcal' as const,
    visibility: 'space',
    created_by: null
  }))

  // Insert resources
  const { data: insertedResources, error: resourceError } = await supabase
    .from('resource')
    .upsert(resources, {
      onConflict: 'url', // Don't duplicate events with same URL
      ignoreDuplicates: true
    })
    .select()

  if (resourceError) {
    console.warn('Failed to create resource entries for calendar events:', resourceError)
    return []
  }

  // Create event_meta for each resource
  const eventMetas = []
  for (let i = 0; i < (insertedResources || []).length; i++) {
    const resource = insertedResources[i]
    const event = events[i]
    
    if (resource && event) {
      eventMetas.push({
        resource_id: resource.id,
        start_at: event.start,
        end_at: event.end,
        location: event.location,
        cost: null,
        dress_code: null
      })
    }
  }

  if (eventMetas.length > 0) {
    const { error: metaError } = await supabase
      .from('event_meta')
      .upsert(eventMetas, {
        onConflict: 'resource_id',
        ignoreDuplicates: true
      })

    if (metaError) {
      console.warn('Failed to create event_meta entries:', metaError)
    }
  }

  return insertedResources || []
}

