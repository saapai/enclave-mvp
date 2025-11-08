/**
 * TurnFrame Builder
 * 
 * Builds a normalized TurnFrame from SMS input, extracting all signals
 * and context needed for deterministic planning.
 */

import { TurnFrame, Command, Toxicity, ParsedTime, Draft, PollState } from './types'
import { supabase } from '@/lib/supabase'
import { getActiveDraft } from '@/lib/announcements'
import { getActivePollDraft } from '@/lib/polls'
import { extractQuotes } from '@/lib/nlp/quotes'
import { routeAction } from '@/lib/nlp/actionRouter'

export function normalizePhone(phone: string): string {
  const cleaned = String(phone).replace(/[^\d]/g, '')
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    return cleaned.substring(1)
  }
  return cleaned.slice(-10)
}

/**
 * Extract quoted segments from text
 */
function extractQuotedSegments(text: string): string[] {
  return extractQuotes(text)
}

/**
 * Detect command from text
 */
function detectCommand(text: string, hasActiveDraft: boolean): Command {
  const lower = text.toLowerCase().trim()
  
  // Send commands
  if (/^(send|send it|send now|broadcast|ship it)/i.test(lower)) {
    return 'SEND'
  }
  
  // Cancel commands
  if (/(cancel|delete|remove|discard)\s+(the\s+)?(announcement|poll|draft)/i.test(lower)) {
    return 'CANCEL'
  }
  
  // Edit commands (only if draft exists)
  if (hasActiveDraft && /^(edit|change|update|make it|change it)/i.test(lower)) {
    return 'EDIT'
  }
  
  // Make announcement
  if (/(make|create|send|post)\s+(an?\s+)?(announcement|announce)/i.test(lower) || 
      /i\s+(want|wanna|wanna)\s+(to\s+)?(make|create|send|post)\s+(an?\s+)?(announcement|announce)/i.test(lower)) {
    return 'MAKE_ANNOUNCEMENT'
  }
  
  // Make poll
  if (/(make|create|send)\s+(an?\s+)?(poll|survey)/i.test(lower) ||
      /i\s+(want|wanna|wanna)\s+(to\s+)?(make|create|send)\s+(an?\s+)?(poll|survey)/i.test(lower)) {
    return 'MAKE_POLL'
  }
  
  return null
}

/**
 * Detect toxicity level
 */
function detectToxicity(text: string): Toxicity {
  const lower = text.toLowerCase()
  
  // Hard abusive words
  if (/(retard|retarded|fuck\s+you|kill\s+yourself|die)/i.test(lower)) {
    return 'abusive'
  }
  
  // Mild profanity/rude
  if (/(damn|hell|shit|ass)/i.test(lower) && lower.length < 50) {
    return 'rude'
  }
  
  return 'ok'
}

/**
 * Parse time from text (simple patterns)
 */
function parseTime(text: string): ParsedTime | undefined {
  // Patterns: "8pm", "8:30pm", "8 pm", "20:00", etc.
  const patterns = [
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    /(\d{1,2}):(\d{2})/,
    /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  ]
  
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const hour = parseInt(match[1], 10)
      const minute = match[2] ? parseInt(match[2], 10) : 0
      const ampm = match[3]?.toLowerCase() as 'am' | 'pm' | undefined
      
      return { hour, minute, ampm }
    }
  }
  
  return undefined
}

/**
 * Parse date from text (simple - just check for "tomorrow", "today", etc.)
 */
function parseDate(text: string, now: Date): Date | undefined {
  const lower = text.toLowerCase()
  
  if (lower.includes('tomorrow')) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return d
  }
  
  if (lower.includes('today')) {
    return now
  }
  
  return undefined
}

/**
 * Extract people mentions (simple - just names after "who is" or "@")
 */
function extractPeople(text: string): string[] {
  const people: string[] = []
  
  // "who is X" pattern
  const whoIsMatch = text.match(/who\s+is\s+(\w+)/i)
  if (whoIsMatch) {
    people.push(whoIsMatch[1])
  }
  
  // @ mentions
  const atMentions = text.match(/@(\w+)/g)
  if (atMentions) {
    people.push(...atMentions.map(m => m.slice(1)))
  }
  
  return people
}

/**
 * Determine current mode from conversation history and active drafts
 */
async function determineMode(
  phoneNumber: string,
  text: string,
  lastBotMessage: string
): Promise<{ mode: Mode; pending?: Draft | PollState }> {
  const stepStart = Date.now()
  console.log(`[TurnFrame] determineMode start for ${phoneNumber}`)
  const normalizedPhone = normalizePhone(phoneNumber)
  
  // Check for active drafts
  const draftStart = Date.now()
  const activeDraft = await getActiveDraft(normalizedPhone)
  console.log(`[TurnFrame] getActiveDraft (determineMode) completed in ${Date.now() - draftStart}ms ${activeDraft ? '(found)' : '(none)'}`)
  const pollStart = Date.now()
  const activePollDraft = await getActivePollDraft(normalizedPhone)
  console.log(`[TurnFrame] getActivePollDraft (determineMode) completed in ${Date.now() - pollStart}ms ${activePollDraft ? '(found)' : '(none)'}`)
  
  // PRIORITY 1: Check if user is making a NEW request (not responding to bot)
  // This must come BEFORE checking for confirm mode to avoid false positives
  const lowerText = text.toLowerCase()
  const isNewPollRequest = /(make|create|send)\s+(an?\s+)?(poll|survey)/i.test(text) ||
                           /i\s+(want|wanna)\s+(to\s+)?(make|create|send)\s+(an?\s+)?(poll|survey)/i.test(text)
  const isNewAnnouncementRequest = /(make|create|send|post)\s+(an?\s+|out\s+an?\s+)?(announcement|announce|message|blast)/i.test(text) ||
                                   /i\s+(want|wanna)\s+(to\s+)?(make|create|send|post)\s+(an?\s+)?(announcement|announce)/i.test(text) ||
                                   /(broadcast|blast)\s*:/i.test(text) // Colon-style commands are always new
  
  // Check if user is asking an explicit question (should be treated as query, not draft input)
  // Questions can have '?' or just start with question words
  const isExplicitQuestion = /^(what|when|where|who|how|why|is|are|was|were|do|does|did|will|can|could|should)\s/i.test(text) || text.includes('?')
  
  // If it's a new request, ignore existing drafts and go to IDLE (plan will route to create)
  if (isNewPollRequest || isNewAnnouncementRequest) {
    return { mode: 'IDLE' }
  }
  
  // PRIORITY 2: If bot asked for announcement content, we're in ANNOUNCEMENT_INPUT
  if (lastBotMessage.toLowerCase().includes('what would you like the announcement to say')) {
    return { 
      mode: 'ANNOUNCEMENT_INPUT', 
      pending: activeDraft ? { 
        id: activeDraft.id || '',
        kind: 'announcement',
        body: activeDraft.content || '',
        audience: activeDraft.targetAudience === 'all' || !activeDraft.targetAudience ? 'all' : [activeDraft.targetAudience],
        created_by: normalizedPhone,
        last_edit_ts: activeDraft.updatedAt || new Date().toISOString(),
        workspace_id: activeDraft.workspaceId
      } : undefined
    }
  }
  
  // If bot asked for poll content, we're in POLL_INPUT
  if (lastBotMessage.toLowerCase().includes('what would you like to ask in the poll')) {
    return { 
      mode: 'POLL_INPUT',
      pending: activePollDraft ? {
        id: activePollDraft.id || '',
        kind: 'poll',
        question: activePollDraft.question || '',
        options: activePollDraft.options || [],
        audience: 'all',
        created_by: normalizedPhone,
        last_edit_ts: activePollDraft.updatedAt || new Date().toISOString(),
        workspace_id: activePollDraft.workspaceId
      } : undefined
    }
  }
  
  // If draft exists and ready to send, check if we're in confirm mode
  // BUT: If user is asking an explicit question, treat as IDLE (query) instead
  if ((activeDraft || activePollDraft) && !isExplicitQuestion) {
    // Check if last bot message was asking to confirm send
    const lowerLastBot = lastBotMessage.toLowerCase()
    if (lowerLastBot.includes('reply "send it"') || lowerLastBot.includes('reply "send now"')) {
      return {
        mode: 'CONFIRM_SEND',
        pending: activeDraft ? {
          id: activeDraft.id || '',
          kind: 'announcement',
          body: activeDraft.content || '',
          audience: activeDraft.targetAudience === 'all' || !activeDraft.targetAudience ? 'all' : [activeDraft.targetAudience],
          created_by: normalizedPhone,
          last_edit_ts: activeDraft.updatedAt || new Date().toISOString(),
          workspace_id: activeDraft.workspaceId
        } : activePollDraft ? {
          id: activePollDraft.id || '',
          kind: 'poll',
          question: activePollDraft.question || '',
          options: activePollDraft.options || [],
          audience: 'all',
          created_by: normalizedPhone,
          last_edit_ts: activePollDraft.updatedAt || new Date().toISOString(),
          workspace_id: activePollDraft.workspaceId
        } : undefined
      }
    }
    
    // Otherwise, if draft exists and user is NOT asking a question, we're in input mode
    // But if user IS asking a question, treat as IDLE (query) instead
    if (!isExplicitQuestion) {
      if (activeDraft) {
        return {
          mode: 'ANNOUNCEMENT_INPUT',
          pending: {
            id: activeDraft.id || '',
            kind: 'announcement',
            body: activeDraft.content || '',
            audience: activeDraft.targetAudience === 'all' || !activeDraft.targetAudience ? 'all' : [activeDraft.targetAudience],
            created_by: normalizedPhone,
            last_edit_ts: activeDraft.updatedAt || new Date().toISOString(),
            workspace_id: activeDraft.workspaceId
          }
        }
      }
      
      if (activePollDraft) {
        return {
          mode: 'POLL_INPUT',
          pending: {
            id: activePollDraft.id || '',
            kind: 'poll',
            question: activePollDraft.question || '',
            options: activePollDraft.options || [],
            audience: 'all',
            created_by: normalizedPhone,
            last_edit_ts: activePollDraft.updatedAt || new Date().toISOString(),
            workspace_id: activePollDraft.workspaceId
          }
        }
      }
    }
  }
  
  // Default: IDLE
  console.log(`[TurnFrame] determineMode fallback to IDLE in ${Date.now() - stepStart}ms`)
  return { mode: 'IDLE' }
}

/**
 * Build TurnFrame from SMS input
 */
export async function buildTurnFrame(
  phoneNumber: string,
  text: string,
  userId?: string,
  orgId?: string
): Promise<TurnFrame> {
  const overallStart = Date.now()
  const normalizedPhone = normalizePhone(phoneNumber)
  const now = new Date()
  console.log(`[TurnFrame] buildTurnFrame start for ${normalizedPhone}`)
  
  // Get conversation history
  let history: Array<{ user_message: string; bot_response: string; created_at: string }> | null = null
  try {
    const historyStart = Date.now()
    console.log(`[TurnFrame] Loading conversation history for ${normalizedPhone}`)
    const { data } = await supabase
      .from('sms_conversation_history')
      .select('user_message, bot_response, created_at')
      .eq('phone_number', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(5)
    history = data
    console.log(`[TurnFrame] Loaded conversation history in ${Date.now() - historyStart}ms (rows=${history?.length || 0})`)
  } catch (err) {
    console.error('[TurnFrame] Failed to load conversation history:', err)
  }
  
  const lastN = (history || []).reverse().flatMap(msg => [
    { speaker: 'user' as const, text: msg.user_message, ts: msg.created_at },
    { speaker: 'bot' as const, text: msg.bot_response, ts: msg.created_at }
  ])
  
  const lastBotMessage = history && history.length > 0 
    ? history[history.length - 1].bot_response 
    : ''
  
  const lastBotAct = lastBotMessage 
    ? { type: 'prompt', text: lastBotMessage, ts: history?.[history.length - 1]?.created_at || now.toISOString() }
    : undefined
  
  // Determine mode and pending state
  const modeStart = Date.now()
  const { mode, pending } = await determineMode(normalizedPhone, text, lastBotMessage)
  console.log(`[TurnFrame] determineMode completed in ${Date.now() - modeStart}ms (mode=${mode})`)
  
  // Check for active drafts to determine command context
  const activeDraftStart = Date.now()
  const activeDraft = await getActiveDraft(normalizedPhone)
  console.log(`[TurnFrame] getActiveDraft completed in ${Date.now() - activeDraftStart}ms ${activeDraft ? '(found)' : '(none)'}`)
  const activePollStart = Date.now()
  const activePollDraft = await getActivePollDraft(normalizedPhone)
  console.log(`[TurnFrame] getActivePollDraft completed in ${Date.now() - activePollStart}ms ${activePollDraft ? '(found)' : '(none)'}`)
  const hasActiveDraft = !!(activeDraft || activePollDraft)
  
  // Extract signals
  const quoted = extractQuotedSegments(text)
  const hasQuestionMark = text.includes('?')
  const command = detectCommand(text, hasActiveDraft)
  const toxicity = detectToxicity(text)
  const time = parseTime(text)
  const date = parseDate(text, now)
  const people = extractPeople(text)
  const frame: TurnFrame = {
    now,
    user: { id: userId || normalizedPhone, role: undefined },
    convo: { lastN, lastBotAct },
    state: { mode, pending },
    text,
    signals: {
      quoted,
      hasQuestionMark,
      command,
      entities: { time, date, people: people.length > 0 ? people : undefined },
      toxicity
    }
  }

  console.log(`[TurnFrame] buildTurnFrame completed in ${Date.now() - overallStart}ms for ${normalizedPhone}`)
  return frame
}
