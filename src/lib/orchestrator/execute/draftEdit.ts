/**
 * Execute Draft Edit Mode
 * 
 * Pure reducer for announcement drafts - deterministic transforms, no LLM unless needed
 */

import { TurnFrame, ContextEnvelope, Draft } from '../types'
import { saveDraft } from '@/lib/announcements'
import { extractRawAnnouncementText, patchAnnouncementDraft, isExactTextRequest } from '@/lib/announcements'
import { normalizePhone } from '../frame'

/**
 * Patch time into announcement text
 */
function patchTime(text: string, time: { hour: number; minute: number; ampm?: 'am' | 'pm' }): string {
  const timeStr = `${time.hour}:${time.minute.toString().padStart(2, '0')}${time.ampm || ''}`
  
  // Check if time already exists
  if (text.toLowerCase().includes(timeStr.toLowerCase())) {
    return text
  }
  
  // Append time if not present
  if (/at\s+\d/.test(text)) {
    // Replace existing time
    return text.replace(/at\s+\d[\d:]*\s*(am|pm)?/i, `at ${timeStr}`)
  }
  
  // Append time
  return `${text} at ${timeStr}`
}

/**
 * Ensure "at X" phrase exists
 */
function ensureAtPhrase(text: string, input: string): string {
  const atMatch = input.match(/at\s+(\d[\d:]*\s*(?:am|pm)?)/i)
  if (atMatch) {
    const timePart = atMatch[1]
    if (!text.toLowerCase().includes(timePart.toLowerCase())) {
      return `${text} at ${timePart}`
    }
  }
  return text
}

/**
 * Smart append - merge new content intelligently
 */
function smartAppend(existing: string, input: string): string {
  // If input is very short, try to merge
  if (input.length < 30) {
    // Check if it's a time/date fragment
    if (/\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i.test(input)) {
      return ensureAtPhrase(existing, input)
    }
    
    // Otherwise append as-is
    return `${existing} ${input}`.trim()
  }
  
  // If input is longer, it might be a replacement
  // Check if it starts with "it's" or "the meeting" etc.
  if (/^(it'?s|the\s+(meeting|event|announcement))/i.test(input)) {
    return input
  }
  
  // Default: append
  return `${existing} ${input}`.trim()
}

/**
 * Normalize whitespace
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Reduce announcement draft - deterministic transform
 */
function reduceAnnouncement(
  pending: Draft,
  input: string,
  signals: TurnFrame['signals']
): Draft {
  // 1) Verbatim quotes override everything
  if (signals.quoted.length > 0) {
    return {
      ...pending,
      body: signals.quoted.join(' ').trim(),
      last_edit_ts: new Date().toISOString()
    }
  }
  
  // 2) Exact text request
  if (isExactTextRequest(input)) {
    const exactText = extractRawAnnouncementText(input)
    return {
      ...pending,
      body: exactText,
      last_edit_ts: new Date().toISOString()
    }
  }
  
  // 3) Apply structured patches
  let next = pending.body || ''
  
  // Patch time
  if (signals.entities.time) {
    next = patchTime(next, signals.entities.time)
  }
  
  // Patch "at X" phrases
  if (/make\s+it\s+.*?\s+at/i.test(input) || /at\s+\d/.test(input)) {
    next = ensureAtPhrase(next, input)
  }
  
  // 4) Use intelligent patching for complex edits
  if (next === (pending.body || '')) {
    // No structured patches applied, use intelligent patching
    next = patchAnnouncementDraft(pending.body || '', input)
  } else {
    // Structured patches applied, but might need smart append for remaining parts
    const remaining = input.replace(/at\s+\d[\d:]*\s*(?:am|pm)?/i, '').trim()
    if (remaining.length > 0 && remaining.length < 100) {
      next = smartAppend(next, remaining)
    }
  }
  
  // 5) Normalize
  next = normalizeWhitespace(next)
  
  return {
    ...pending,
    body: next,
    last_edit_ts: new Date().toISOString()
  }
}

export interface ExecuteResult {
  messages: string[]
  newMode?: 'IDLE' | 'ANNOUNCEMENT_INPUT' | 'POLL_INPUT' | 'CONFIRM_SEND'
}

/**
 * Execute Draft Edit mode
 */
export async function executeDraftEdit(
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  const pending = envelope.system_state.pending_draft
  
  if (!pending || pending.kind !== 'announcement') {
    return {
      messages: ['No announcement draft found.']
    }
  }
  
  // Reduce the draft
  const reduced = reduceAnnouncement(pending, frame.text, frame.signals)
  
  // Save the draft
  const normalizedPhone = normalizePhone(frame.user.id)
  await saveDraft(normalizedPhone, {
    id: reduced.id,
    content: reduced.body || '',
    tone: 'casual', // TODO: preserve tone from previous draft
    scheduledFor: undefined,
    targetAudience: reduced.audience === 'all' ? 'all' : reduced.audience[0],
    workspaceId: reduced.workspace_id
  }, reduced.workspace_id!)
  
  return {
    messages: [`updated:\n\n${reduced.body}\n\nreply "send it" to broadcast`],
    newMode: 'ANNOUNCEMENT_INPUT'
  }
}

