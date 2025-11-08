/**
 * Deterministic Router
 * 
 * Rules first (O(1)), LLM fallback only for ambiguous cases.
 * Never overrides session state mode without explicit control commands.
 */

import { Intent, DraftType, Mode } from './types'
import { parseVerbatimConstraint, parseMustInclude, parseMustNotChange } from './constraint'

/**
 * Extract time entities from text using deterministic patterns
 */
function extractTime(text: string): string | null {
  // Patterns: "at 9pm", "at 9:30am", "9pm", "9:30 PM"
  const patterns = [
    /\b(\d{1,2}):?(\d{2})?\s*(am|pm)\b/i,
    /\bat\s+(\d{1,2}):?(\d{2})?\s*(am|pm)\b/i,
  ]
  
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const hour = parseInt(match[1])
      const minute = match[2] ? parseInt(match[2]) : 0
      const ampm = match[3].toLowerCase()
      
      // Convert to 24-hour for ISO
      let hour24 = hour
      if (ampm === 'pm' && hour !== 12) hour24 += 12
      if (ampm === 'am' && hour === 12) hour24 = 0
      
      // Return ISO time (just HH:MM for now, full ISO with date would be in date extraction)
      return `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`
    }
  }
  
  return null
}

/**
 * Extract location from text
 */
function extractLocation(text: string): string | null {
  // Patterns: "at X", "at the X", "in X", "in the X"
  const patterns = [
    /\b(?:at|in)\s+(?:the\s+)?([A-Z][A-Za-z\s']+(?:apartment|house|room|building|hall|field|gym|SAC|court|lab)?)/,
    /\b(?:at|in)\s+([A-Z][A-Za-z]+(?:'s\s+(?:apartment|house|place|room))?)/,
  ]
  
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return match[1].trim()
    }
  }
  
  return null
}

/**
 * Control command detection (send, cancel, edit)
 */
function detectControlCommand(text: string): { is_control: boolean; command?: 'send' | 'cancel' | 'edit' } {
  const lower = text.toLowerCase().trim()
  
  // Send patterns
  if (/^(send\s+it|send\s+now|yes|yep|yeah|y|broadcast|ship\s+it|confirm|go\s+ahead)$/i.test(lower)) {
    return { is_control: true, command: 'send' }
  }
  
  // Cancel patterns
  if (/^(cancel|stop|never\s+mind|forget\s+it|discard)$/i.test(lower)) {
    return { is_control: true, command: 'cancel' }
  }
  
  // Edit patterns (simple negation or edit request)
  if (/^(no|nope|edit|change|update)$/i.test(lower)) {
    return { is_control: true, command: 'edit' }
  }
  
  return { is_control: false }
}

/**
 * Deterministic rule-based routing
 * 
 * Returns Intent if a rule fires, null if LLM fallback needed
 */
export function routeWithRules(text: string): Intent | null {
  const lower = text.toLowerCase().trim()
  const verbatimConstraint = parseVerbatimConstraint(text)
  const controlCommand = detectControlCommand(text)
  
  // Rule: Control commands always take precedence
  if (controlCommand.is_control) {
    return {
      type: 'system',
      is_control_command: true,
      mode_transition: controlCommand.command === 'send' ? 'sending' :
                      controlCommand.command === 'cancel' ? 'idle' :
                      'editing'
    }
  }
  
  // Rule: Questions are queries (start with question words or contain ?)
  if (/^(what|when|where|who|how|why|is|are|was|were|do|does|did|will|can|could|should)\s/i.test(text) || text.includes('?')) {
    return {
      type: 'query'
    }
  }
  
  // Rule: "send out a message:", "send a message:", "broadcast:" → new announcement
  if (/\b(send|broadcast|blast)(?:\s+out)?(?:\s+an?\s+)?(?:message|announcement)\b/i.test(text) ||
      /(broadcast|blast)\s*:/i.test(text)) {
    
    // Extract content after colon if present
    const colonMatch = text.match(/:\s*(.+)$/i)
    const content = colonMatch ? colonMatch[1].trim() : null
    
    return {
      type: 'announcement',
      mode_transition: 'drafting',
      fields_changed: content ? { body: content } : undefined,
      ...(verbatimConstraint.is_verbatim ? { quoted_text: verbatimConstraint.text } : {})
    }
  }
  
  // Rule: "make a poll", "create a poll", "send a poll" → new poll
  if (/\b(make|create|send)(?:\s+an?\s+)?(?:poll|survey)\b/i.test(text)) {
    return {
      type: 'poll',
      mode_transition: 'drafting'
    }
  }
  
  // Rule: Verbatim constraint detected → editing with verbatim
  if (verbatimConstraint.is_verbatim) {
    return {
      type: 'announcement', // assume announcement for now
      mode_transition: 'editing',
      quoted_text: verbatimConstraint.text,
      fields_locked: ['body'] // lock body since it's verbatim
    }
  }
  
  // Rule: Time pattern detected → editing with time update
  const time = extractTime(text)
  if (time && /\b(make\s+it|change\s+it\s+to|at)\b/i.test(lower)) {
    return {
      type: 'announcement',
      mode_transition: 'editing',
      fields_changed: { time }
    }
  }
  
  // Rule: Location pattern detected → editing with location update
  const location = extractLocation(text)
  if (location && /\b(make\s+it|change\s+it\s+to|at|in)\b/i.test(lower)) {
    return {
      type: 'announcement',
      mode_transition: 'editing',
      fields_changed: { location }
    }
  }
  
  // Rule: Simple greetings/acknowledgments → smalltalk
  if (/^(hi|hey|hello|sup|what'?s\s+up|yo|thanks?|thank\s+you|ty|thx|ok|okay|sure|alright|got\s+it|cool|nice|sweet)$/i.test(lower)) {
    return {
      type: 'smalltalk'
    }
  }
  
  // No rule fired → LLM fallback needed
  return null
}

/**
 * LLM fallback for ambiguous cases
 * 
 * Only called when rule-based routing returns null
 */
export async function routeWithLLM(text: string, historyWindow: string[]): Promise<Intent> {
  // TODO: Implement LLM fallback
  // For now, default to announcement editing
  return {
    type: 'announcement',
    mode_transition: 'editing',
    fields_changed: { body: text }
  }
}

/**
 * Main router entry point
 */
export async function route(text: string, historyWindow: string[] = []): Promise<Intent> {
  // Try rules first
  const ruleIntent = routeWithRules(text)
  if (ruleIntent) {
    return ruleIntent
  }
  
  // Fallback to LLM for ambiguous cases
  return routeWithLLM(text, historyWindow)
}


