import { google } from 'googleapis'
import { supabase } from '@/lib/supabase'
import { embedText } from '@/lib/embeddings'
import { createOAuthClient } from '@/lib/google-docs'

// Create authenticated Google Calendar client
export function createCalendarClient(tokens: any) {
  const auth = createOAuthClient()
  auth.setCredentials(tokens)
  return google.calendar({ version: 'v3', auth })
}

// Fetch calendar list
export async function listCalendars(tokens: any) {
  const calendar = createCalendarClient(tokens)
  
  const response = await calendar.calendarList.list({
    minAccessRole: 'reader'
  })

  return response.data.items || []
}

// Fetch events from a calendar
export async function fetchCalendarEvents(
  tokens: any,
  calendarId: string,
  timeMin?: Date,
  timeMax?: Date,
  maxResults = 250
) {
  const calendar = createCalendarClient(tokens)
  
  const response = await calendar.events.list({
    calendarId,
    timeMin: (timeMin || new Date()).toISOString(),
    timeMax: timeMax?.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime'
  })

  return response.data.items || []
}

// Format calendar event for storage
export function formatCalendarEvent(event: any, calendarName: string) {
  const start = event.start?.dateTime || event.start?.date
  const end = event.end?.dateTime || event.end?.date
  const isAllDay = !event.start?.dateTime

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

// Store calendar events with embeddings
export async function storeCalendarEvents(
  spaceId: string,
  sourceId: string,
  events: any[]
) {
  // Delete old events for this source
  await supabase
    .from('calendar_events')
    .delete()
    .eq('source_id', sourceId)

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
        is_all_day: event.isAllDay,
        attendees: event.attendees,
        html_link: event.htmlLink,
        status: event.status,
        organizer: event.organizer,
        recurring_event_id: event.recurringEventId,
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

