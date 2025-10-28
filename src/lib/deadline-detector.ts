/**
 * Deadline Detector
 * Extracts deadlines from text and creates proactive alerts
 */

import { supabaseAdmin } from './supabase'

// ============================================================================
// TYPES
// ============================================================================

export interface Deadline {
  text: string
  date: Date
  confidence: number
  context: string
}

export interface Alert {
  id?: string
  space_id: string
  kind: 'deadline' | 'event_reminder' | 'custom'
  fire_at: string
  title: string
  message: string
  recipients: string[]
  source_type?: string
  source_id?: string
  metadata?: Record<string, any>
}

// ============================================================================
// DEADLINE PATTERNS
// ============================================================================

const DEADLINE_PATTERNS = [
  // "due tonight", "due tomorrow"
  /\b(due|deadline|submit|application closes?)\s+(tonight|tomorrow|today)/gi,
  
  // "due on Monday", "deadline is Friday"
  /\b(due|deadline|submit|application closes?)\s+(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
  
  // "due Nov 8", "deadline November 8th"
  /\b(due|deadline|submit|application closes?)\s+(on\s+)?([A-Z][a-z]+)\s+(\d{1,2})(st|nd|rd|th)?/gi,
  
  // "by 11:59 PM", "before midnight"
  /\b(by|before)\s+(\d{1,2}):?(\d{2})?\s*(am|pm|midnight)/gi,
  
  // "applications close on..."
  /applications?\s+close\s+(on\s+)?([A-Z][a-z]+\s+\d{1,2})/gi
]

const URGENCY_KEYWORDS = [
  'urgent', 'asap', 'immediately', 'today', 'tonight', 'tomorrow',
  'last chance', 'final', 'closing soon'
]

// ============================================================================
// DEADLINE EXTRACTION
// ============================================================================

/**
 * Extract deadlines from text
 */
export function extractDeadlines(text: string): Deadline[] {
  const deadlines: Deadline[] = []
  const now = new Date()

  for (const pattern of DEADLINE_PATTERNS) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const matchText = match[0]
      const context = text.substring(
        Math.max(0, match.index - 50),
        Math.min(text.length, match.index + matchText.length + 50)
      )

      // Parse date from match
      const date = parseDeadlineDate(matchText, now)
      
      if (date) {
        // Calculate confidence based on specificity
        let confidence = 0.7
        
        // Higher confidence if specific date
        if (matchText.match(/\d{1,2}/)) confidence += 0.1
        
        // Higher confidence if time specified
        if (matchText.match(/\d{1,2}:\d{2}/)) confidence += 0.1
        
        // Higher confidence if urgency keywords
        if (URGENCY_KEYWORDS.some(kw => text.toLowerCase().includes(kw))) {
          confidence += 0.1
        }

        deadlines.push({
          text: matchText,
          date,
          confidence: Math.min(1.0, confidence),
          context
        })
      }
    }
  }

  // Deduplicate by date (keep highest confidence)
  const deduped = new Map<string, Deadline>()
  for (const deadline of deadlines) {
    const key = deadline.date.toISOString().split('T')[0]
    const existing = deduped.get(key)
    
    if (!existing || deadline.confidence > existing.confidence) {
      deduped.set(key, deadline)
    }
  }

  return Array.from(deduped.values())
}

/**
 * Parse deadline date from text
 */
function parseDeadlineDate(text: string, now: Date): Date | null {
  const lowerText = text.toLowerCase()

  // "tonight" = today at 11:59 PM
  if (lowerText.includes('tonight')) {
    const date = new Date(now)
    date.setHours(23, 59, 0, 0)
    return date
  }

  // "tomorrow" = tomorrow at 11:59 PM
  if (lowerText.includes('tomorrow')) {
    const date = new Date(now)
    date.setDate(date.getDate() + 1)
    date.setHours(23, 59, 0, 0)
    return date
  }

  // "today" = today at 11:59 PM
  if (lowerText.includes('today')) {
    const date = new Date(now)
    date.setHours(23, 59, 0, 0)
    return date
  }

  // Day of week (e.g., "Monday")
  const dayMatch = text.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
  if (dayMatch) {
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6
    }
    
    const targetDay = dayMap[dayMatch[1].toLowerCase()]
    const currentDay = now.getDay()
    let daysUntil = targetDay - currentDay
    if (daysUntil <= 0) daysUntil += 7
    
    const date = new Date(now)
    date.setDate(now.getDate() + daysUntil)
    date.setHours(23, 59, 0, 0)
    return date
  }

  // Specific date (e.g., "Nov 8", "November 8th")
  const dateMatch = text.match(/([A-Z][a-z]+)\s+(\d{1,2})/i)
  if (dateMatch) {
    const monthMap: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5,
      jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
      oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
    }
    
    const month = monthMap[dateMatch[1].toLowerCase()]
    const day = parseInt(dateMatch[2])
    
    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(now.getFullYear(), month, day, 23, 59, 0, 0)
      
      // If date is in the past, assume next year
      if (date < now) {
        date.setFullYear(date.getFullYear() + 1)
      }
      
      return date
    }
  }

  return null
}

// ============================================================================
// ALERT CREATION
// ============================================================================

/**
 * Create alert from deadline
 */
export async function createDeadlineAlert(
  deadline: Deadline,
  spaceId: string,
  recipients: string[],
  sourceType?: string,
  sourceId?: string
): Promise<string | null> {
  // Calculate when to fire alert (1 hour before deadline)
  const fireAt = new Date(deadline.date)
  fireAt.setHours(fireAt.getHours() - 1)

  // Don't create alerts for past deadlines
  if (fireAt < new Date()) {
    console.log(`[Deadline Detector] Skipping past deadline: ${deadline.text}`)
    return null
  }

  const alert: Alert = {
    space_id: spaceId,
    kind: 'deadline',
    fire_at: fireAt.toISOString(),
    title: 'Deadline Reminder',
    message: `Reminder: ${deadline.text} in 1 hour!\n\nContext: ${deadline.context}`,
    recipients,
    source_type: sourceType,
    source_id: sourceId,
    metadata: {
      original_text: deadline.text,
      extracted_date: deadline.date.toISOString(),
      confidence: deadline.confidence
    }
  }

  const { data, error } = await supabaseAdmin
    .from('alert')
    .insert(alert)
    .select('id')
    .single()

  if (error) {
    console.error('[Deadline Detector] Error creating alert:', error)
    return null
  }

  console.log(`[Deadline Detector] Created alert ${data.id} for ${deadline.text}`)
  return data.id
}

/**
 * Create event reminder alert
 */
export async function createEventReminder(
  eventName: string,
  eventDate: Date,
  location: string | undefined,
  spaceId: string,
  recipients: string[],
  sourceId?: string
): Promise<string | null> {
  // Fire 1 hour before event
  const fireAt = new Date(eventDate)
  fireAt.setHours(fireAt.getHours() - 1)

  if (fireAt < new Date()) {
    return null
  }

  const locationText = location ? ` at ${location}` : ''
  const message = `Reminder: ${eventName} in 1 hour${locationText}!`

  const alert: Alert = {
    space_id: spaceId,
    kind: 'event_reminder',
    fire_at: fireAt.toISOString(),
    title: 'Event Reminder',
    message,
    recipients,
    source_type: 'event',
    source_id: sourceId
  }

  const { data, error } = await supabaseAdmin
    .from('alert')
    .insert(alert)
    .select('id')
    .single()

  if (error) {
    console.error('[Deadline Detector] Error creating event reminder:', error)
    return null
  }

  console.log(`[Deadline Detector] Created event reminder ${data.id} for ${eventName}`)
  return data.id
}

/**
 * Process resource for deadlines
 */
export async function processResourceForDeadlines(
  resourceId: string,
  resourceBody: string,
  spaceId: string,
  recipients: string[]
): Promise<number> {
  const deadlines = extractDeadlines(resourceBody)
  
  console.log(`[Deadline Detector] Found ${deadlines.length} deadlines in resource ${resourceId}`)

  let created = 0
  for (const deadline of deadlines) {
    const alertId = await createDeadlineAlert(
      deadline,
      spaceId,
      recipients,
      'resource',
      resourceId
    )
    
    if (alertId) created++
  }

  return created
}

