/**
 * Knowledge Graph Layer
 * Structured knowledge extraction and querying for Poke-like responses
 */

import { supabase, supabaseAdmin } from './supabase'

// ============================================================================
// TYPES
// ============================================================================

export interface Event {
  id: string
  space_id: string
  name: string
  series_slug?: string
  description?: string
  start_at?: string
  end_at?: string
  rrule?: string
  timezone?: string
  location?: string
  location_details?: Record<string, any>
  hosts?: string[]
  required?: boolean
  source_type?: string
  source_id?: string
  chunk_id?: string
  start_offset?: number
  end_offset?: number
  confidence?: number
  last_seen?: string
  created_at?: string
  updated_at?: string
  created_by?: string
}

export interface EventAlias {
  id: string
  event_id: string
  alias: string
  created_at?: string
}

export interface Policy {
  id: string
  space_id: string
  title: string
  slug?: string
  summary?: string
  bullets?: string[]
  audience?: string
  category?: string
  effective_date?: string
  source_type?: string
  source_id?: string
  chunk_id?: string
  start_offset?: number
  end_offset?: number
  confidence?: number
  last_seen?: string
  created_at?: string
  updated_at?: string
  created_by?: string
}

export interface Person {
  id: string
  space_id: string
  name: string
  role?: string
  email?: string
  phone?: string
  handles?: Record<string, string>
  org?: string
  class?: string
  created_at?: string
  updated_at?: string
  created_by?: string
}

export interface Fact {
  id: string
  space_id: string
  kind: string
  subject: string
  predicate: string
  object: string
  qualifiers?: Record<string, any>
  source_type?: string
  source_id?: string
  chunk_id?: string
  start_offset?: number
  end_offset?: number
  confidence?: number
  extracted_at?: string
  created_by?: string
}

export interface Linkback {
  id: string
  entity_type: string
  entity_id: string
  source_type: string
  source_id: string
  chunk_id?: string
  start_offset?: number
  end_offset?: number
  source_title?: string
  section_name?: string
  created_at?: string
}

// ============================================================================
// EVENT QUERIES
// ============================================================================

/**
 * Find events by name or alias
 */
export async function findEventByName(
  searchName: string,
  spaceId: string
): Promise<Event[]> {
  const { data, error } = await supabaseAdmin
    .rpc('find_event_by_name', {
      search_name: searchName,
      target_space_id: spaceId
    })

  if (error) {
    console.error('[Knowledge Graph] Error finding event:', error)
    return []
  }

  return data || []
}

/**
 * Get event by ID with linkbacks
 */
export async function getEventWithSources(
  eventId: string
): Promise<{ event: Event | null; sources: string[] }> {
  // Get event
  const { data: event, error: eventError } = await supabaseAdmin
    .from('event')
    .select('*')
    .eq('id', eventId)
    .single()

  if (eventError || !event) {
    return { event: null, sources: [] }
  }

  // Get linkbacks
  const { data: linkbacks } = await supabaseAdmin
    .rpc('get_linkbacks', {
      entity_type_param: 'event',
      entity_id_param: eventId
    })

  const sources = (linkbacks || []).map((l: any) => l.citation)

  return { event, sources }
}

/**
 * Upsert event (create or update)
 */
export async function upsertEvent(event: Partial<Event>): Promise<Event | null> {
  const { data, error } = await supabaseAdmin
    .from('event')
    .upsert(event)
    .select()
    .single()

  if (error) {
    console.error('[Knowledge Graph] Error upserting event:', error)
    return null
  }

  return data
}

/**
 * Add event alias
 */
export async function addEventAlias(
  eventId: string,
  alias: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('event_alias')
    .insert({ event_id: eventId, alias })

  if (error) {
    console.error('[Knowledge Graph] Error adding event alias:', error)
    return false
  }

  return true
}

// ============================================================================
// POLICY QUERIES
// ============================================================================

/**
 * Find policies by title
 */
export async function findPolicyByTitle(
  searchTitle: string,
  spaceId: string
): Promise<Policy[]> {
  const { data, error } = await supabaseAdmin
    .from('policy')
    .select('*')
    .eq('space_id', spaceId)
    .ilike('title', `%${searchTitle}%`)
    .order('confidence', { ascending: false })
    .limit(5)

  if (error) {
    console.error('[Knowledge Graph] Error finding policy:', error)
    return []
  }

  return data || []
}

/**
 * Get policy by slug
 */
export async function getPolicyBySlug(
  slug: string,
  spaceId: string
): Promise<Policy | null> {
  const { data, error } = await supabaseAdmin
    .from('policy')
    .select('*')
    .eq('space_id', spaceId)
    .eq('slug', slug)
    .single()

  if (error) {
    return null
  }

  return data
}

/**
 * Upsert policy
 */
export async function upsertPolicy(policy: Partial<Policy>): Promise<Policy | null> {
  const { data, error } = await supabaseAdmin
    .from('policy')
    .upsert(policy)
    .select()
    .single()

  if (error) {
    console.error('[Knowledge Graph] Error upserting policy:', error)
    return null
  }

  return data
}

// ============================================================================
// PERSON QUERIES
// ============================================================================

/**
 * Find person by name
 */
export async function findPersonByName(
  searchName: string,
  spaceId: string
): Promise<Person[]> {
  const { data, error } = await supabaseAdmin
    .from('person')
    .select('*')
    .eq('space_id', spaceId)
    .ilike('name', `%${searchName}%`)
    .limit(5)

  if (error) {
    console.error('[Knowledge Graph] Error finding person:', error)
    return []
  }

  return data || []
}

/**
 * Get person by role
 */
export async function getPeopleByRole(
  role: string,
  spaceId: string
): Promise<Person[]> {
  const { data, error } = await supabaseAdmin
    .from('person')
    .select('*')
    .eq('space_id', spaceId)
    .eq('role', role)

  if (error) {
    console.error('[Knowledge Graph] Error finding people by role:', error)
    return []
  }

  return data || []
}

/**
 * Upsert person
 */
export async function upsertPerson(person: Partial<Person>): Promise<Person | null> {
  const { data, error } = await supabaseAdmin
    .from('person')
    .upsert(person)
    .select()
    .single()

  if (error) {
    console.error('[Knowledge Graph] Error upserting person:', error)
    return null
  }

  return data
}

// ============================================================================
// LINKBACK HELPERS
// ============================================================================

/**
 * Create linkback for an entity
 */
export async function createLinkback(linkback: Partial<Linkback>): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('linkback')
    .insert(linkback)

  if (error) {
    console.error('[Knowledge Graph] Error creating linkback:', error)
    return false
  }

  return true
}

/**
 * Get linkbacks for an entity
 */
export async function getLinkbacks(
  entityType: string,
  entityId: string
): Promise<string[]> {
  const { data } = await supabaseAdmin
    .rpc('get_linkbacks', {
      entity_type_param: entityType,
      entity_id_param: entityId
    })

  return (data || []).map((l: any) => l.citation)
}

// ============================================================================
// FACT QUERIES
// ============================================================================

/**
 * Query facts by subject
 */
export async function getFactsBySubject(
  subject: string,
  spaceId: string
): Promise<Fact[]> {
  const { data, error } = await supabaseAdmin
    .from('fact')
    .select('*')
    .eq('space_id', spaceId)
    .eq('subject', subject)
    .order('confidence', { ascending: false })

  if (error) {
    console.error('[Knowledge Graph] Error querying facts:', error)
    return []
  }

  return data || []
}

/**
 * Insert fact
 */
export async function insertFact(fact: Partial<Fact>): Promise<Fact | null> {
  const { data, error } = await supabaseAdmin
    .from('fact')
    .insert(fact)
    .select()
    .single()

  if (error) {
    console.error('[Knowledge Graph] Error inserting fact:', error)
    return null
  }

  return data
}

// ============================================================================
// ENTITY EXTRACTION HELPERS
// ============================================================================

/**
 * Extract canonical event slug from name
 * e.g., "Big Little" → "big-little", "AD/AG Summons" → "ad-ag-summons"
 */
export function normalizeEventSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Parse date/time from text
 * Returns ISO string or null
 */
export function parseDateTime(text: string): string | null {
  // Simple patterns for common formats
  // TODO: Use a proper date parsing library like chrono-node
  
  // "Wednesday at 8 PM"
  const dayTimePattern = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?/i
  const match = text.match(dayTimePattern)
  
  if (match) {
    const day = match[1]
    const hour = parseInt(match[2])
    const minute = match[3] ? parseInt(match[3]) : 0
    const ampm = match[4]?.toLowerCase()
    
    // Convert to 24-hour
    let hour24 = hour
    if (ampm === 'pm' && hour !== 12) hour24 += 12
    if (ampm === 'am' && hour === 12) hour24 = 0
    
    // Find next occurrence of this day
    const now = new Date()
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6
    }
    
    const targetDay = dayMap[day.toLowerCase()]
    const currentDay = now.getDay()
    let daysUntil = targetDay - currentDay
    if (daysUntil <= 0) daysUntil += 7
    
    const targetDate = new Date(now)
    targetDate.setDate(now.getDate() + daysUntil)
    targetDate.setHours(hour24, minute, 0, 0)
    
    return targetDate.toISOString()
  }
  
  return null
}

/**
 * Extract location from text
 */
export function extractLocation(text: string): string | null {
  // Common patterns: "at [location]", "in [location]", "@ [location]"
  const patterns = [
    /\bat\s+([A-Z][A-Za-z\s']+(?:apartment|room|building|hall|center)?)/,
    /\bin\s+([A-Z][A-Za-z\s']+(?:apartment|room|building|hall|center)?)/,
    /@\s*([A-Za-z\s']+)/
  ]
  
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return match[1].trim()
    }
  }
  
  return null
}

