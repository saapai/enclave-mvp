/**
 * Unified SMS Handler
 * 
 * Main entry point that orchestrates:
 * - Welcome flow
 * - Context-aware intent classification
 * - Smart command parsing
 * - Announcement/poll generation
 * - Query handling
 */

import { classifyIntent, loadWeightedHistory, IntentType, ConversationMessage, ClassifiedIntent } from './context-aware-classifier'
import { parseCommand, ParsedCommand } from './smart-command-parser'
import { needsWelcome, getWelcomeMessage, handleNameInWelcome, initializeNewUser } from './welcome-flow'
import { generateAnnouncement, formatAnnouncement, AnnouncementDraft } from './enhanced-announcement-generator'
import { checkActionQuery, saveAction, type ActionMemory } from './action-memory'
import { supabaseAdmin } from '@/lib/supabase'
import type { HandleTurnResult } from '@/lib/orchestrator/handleTurn'
import { splitLongMessage } from '@/lib/text/limits'
import type { PendingPollContext } from '@/lib/polls'
// Name declaration is handled inline

const ACTION_MEMORY_TIMEOUT_MS = 150
const PENDING_QUERY_LIFETIME_MS = Number(process.env.PENDING_QUERY_LIFETIME_MS || '120000')
const RECENT_QUERY_LIFETIME_MS = Number(process.env.RECENT_QUERY_LIFETIME_MS || '300000')

interface PendingQueryEntry {
  query: string
  startedAt: number
  expiresAt: number
  status: 'pending' | 'completed' | 'failed'
  response?: string
  completedAt?: number
}

const PENDING_CONTENT_QUERIES = new Map<string, PendingQueryEntry>()
const RECENT_CONTENT_QUERIES = new Map<string, { query: string; response: string; completedAt: number }>()

class TurnAbortedError extends Error {
  constructor(stage?: string) {
    super(`Turn aborted${stage ? ` during ${stage}` : ''}`)
    this.name = 'TurnAbortedError'
  }
}

function throwIfAborted(signal?: AbortSignal, stage?: string): void {
  if (!signal) return
  if (signal.aborted) {
    throw new TurnAbortedError(stage)
  }
}

function isTurnAbortedError(err: unknown): boolean {
  if (!err) return false
  return err instanceof TurnAbortedError || (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError')
}

function cleanupQueryTracking(phoneNumber: string) {
  const now = Date.now()
  const pending = PENDING_CONTENT_QUERIES.get(phoneNumber)
  if (pending && pending.expiresAt <= now) {
    PENDING_CONTENT_QUERIES.delete(phoneNumber)
  }

  const recent = RECENT_CONTENT_QUERIES.get(phoneNumber)
  if (recent && now - recent.completedAt > RECENT_QUERY_LIFETIME_MS) {
    RECENT_CONTENT_QUERIES.delete(phoneNumber)
  }
}

export interface HandlerResult {
  response: string
  shouldSaveHistory: boolean
  metadata?: {
    intent?: IntentType
    draftCreated?: boolean
    welcomeComplete?: boolean
    resultCount?: number
  }
}

function limitEmojis(text: string, maxEmojis = 1): string {
  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu
  let count = 0
  return text.replace(emojiRegex, (match) => {
    if (count < maxEmojis) {
      count += 1
      return match
    }
    return ''
  })
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  fallback: T,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    throw new TurnAbortedError(label)
  }

  let timeoutId: NodeJS.Timeout | null = null
  let abortListener: (() => void) | null = null

  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutId = setTimeout(() => {
        console.error(`[UnifiedHandler] ${label} timed out after ${ms}ms`)
        resolve(fallback)
      }, ms)
    })

    const sources: Promise<T>[] = [promise, timeoutPromise]

    if (signal) {
      const abortPromise = new Promise<T>((_, reject) => {
        abortListener = () => reject(new TurnAbortedError(label))
        signal.addEventListener('abort', abortListener!, { once: true })
      })
      sources.push(abortPromise)
    }

    const result = await Promise.race(sources)
    if (timeoutId) clearTimeout(timeoutId)
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener)
    }
    return result
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener)
    }
    throw err
  }
}

const STATUS_KEYWORDS = [
  /(what(?:'s|\s+is)|where(?:'s|\s+is)|how(?:'s|\s+is)|any|got|have)\s+.*\b(answer|update|status|results|info)\b/i,
  /^(answer|status|update|respond|reply)(\b|\s)/i,
  /(still|ever)\s+.*\b(waiting|searching|looking|working)\b/i,
  /(is it|did it|has it)\s+.*\b(finish|done|complete|find)\b/i
]

function isStatusFollowUp(text: string): boolean {
  const lower = text.trim().toLowerCase()
  if (!lower || lower.length > 160) return false
  return STATUS_KEYWORDS.some(regex => regex.test(lower))
}

const QUESTION_PREFIX = /^(when|what|who|where|why|how|which|is|are|was|were|do|does|did|will|would|should|can|could|answer|tell me)  *./

const POLL_RESPONSE_PATTERNS: RegExp[] = [
  /^(yes|yeah|yep|ya|y|sure|of course|count me in|ill be there|i'll be there|i can make it)(\b|!)/i,
  /^(no|nope|nah|naw|n|can't|cant|cannot|won't|will not|i'm out|im out|i can't)(\b|!)/i,
  /^(maybe|not sure|depends|possibly|might)(\b|!)/i,
  /(i have|i've got|got)\s+(a\s+)?(conflict|midterm|exam|class|meeting)/i,
  /(i can|i can't|i cant|i will|i won't|ill|i'll)\s+(make it|come|be there|attend)/i
]

function isLikelyQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.includes('?')) return true
  return QUESTION_PREFIX.test(normalized)
}

function detectPollCommand(message: string, history: ConversationMessage[]): boolean {
  const lower = message.trim().toLowerCase()
  if (!lower) return false
  if (!(/\bpoll\b/.test(lower) || /\bsurvey\b/.test(lower))) {
    return false
  }

  const lastBotMessage = history
    .filter(msg => msg.role === 'bot')
    .pop()?.text.toLowerCase() || ''

  if (
    lastBotMessage.includes("here's what the poll will say") ||
    lastBotMessage.includes('what would you like to ask in the poll') ||
    lastBotMessage.includes('reply "send it" to send')
  ) {
    return false
  }

  const pollCommandPatterns: RegExp[] = [
    /\b(send|make|create|put out|set up|draft|launch|blast|throw|fire off|text out|shoot out)\b[^.?!]*\b(poll|survey)\b/,
    /\bpoll\b[^.?!]*\bsaying\b/,
    /\bpoll\b[^.?!]*\basking\b/,
    /^poll[:\s]/,
    /^survey[:\s]/
  ]

  return pollCommandPatterns.some((regex) => regex.test(lower))
}

function isLikelyPollResponse(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.length <= 3 && /^(y|n)$/i.test(normalized)) {
    return true
  }
  return POLL_RESPONSE_PATTERNS.some(regex => regex.test(normalized))
}

function queueActionMemorySave(
  phoneNumber: string,
  action: Omit<ActionMemory, 'timestamp'>,
  label: string
) {
  // saveAction is now fire-and-forget (returns void), so just call it
  // The timeout warning is no longer needed since it's non-blocking
  saveAction(phoneNumber, action)
}

/**
 * Main handler for incoming SMS messages
 */
export async function handleSMSMessage(
  phoneNumber: string,
  fullPhoneNumber: string, // E.164 format
  messageText: string,
  preClassifiedIntent?: ClassifiedIntent, // Optional: skip classification if already done
  prefetchedHistory?: ConversationMessage[],
  options: { abortSignal?: AbortSignal; turnId?: number } = {}
): Promise<HandlerResult> {
  const signal = options.abortSignal
  const turnId = options.turnId
  throwIfAborted(signal, 'handleSMSMessage:start')
  console.log(`[UnifiedHandler] Processing message from ${phoneNumber}: "${messageText}"${typeof turnId === 'number' ? ` (turnId=${turnId})` : ''}`)

  cleanupQueryTracking(phoneNumber)
  throwIfAborted(signal, 'after-cleanup')

  // Load conversation history (timeout to avoid hanging on Supabase)
  console.log(`[UnifiedHandler] About to load history with timeout wrapper`)
  let history: ConversationMessage[]
  if (prefetchedHistory && prefetchedHistory.length > 0) {
    history = prefetchedHistory
    console.log(`[UnifiedHandler] Using prefetched history with ${history.length} messages`)
  } else {
    const historyStartTime = Date.now()
    history = await withTimeout(
      loadWeightedHistory(phoneNumber, 10),
      4000,
      'loadWeightedHistory',
      [] as ConversationMessage[],
      signal
    )
    const historyDuration = Date.now() - historyStartTime
    console.log(`[UnifiedHandler] Loaded ${history.length} history messages in ${historyDuration}ms`)
  }

  throwIfAborted(signal, 'post-history')

  // Check welcome flow first
  console.log(`[UnifiedHandler] Checking welcome flow...`)
  const welcomeStartTime = Date.now()
  const needsWelcomeFlow = await withTimeout(
    needsWelcome(phoneNumber),
    2000,
    'needsWelcome',
    false,
    signal
  )
  const welcomeDuration = Date.now() - welcomeStartTime
  console.log(`[UnifiedHandler] Welcome check completed in ${welcomeDuration}ms, needsWelcomeFlow=${needsWelcomeFlow}`)
  
  throwIfAborted(signal, 'post-welcome')
  
  if (needsWelcomeFlow) {
    console.log('[UnifiedHandler] User needs welcome flow')
    // Check if this is a name declaration
    const nameCheck = await checkNameDeclaration(messageText)
    throwIfAborted(signal, 'welcome:name-check')
    if (nameCheck.isName && nameCheck.name) {
      // Initialize user if needed
      await initializeNewUser(phoneNumber, fullPhoneNumber)
      throwIfAborted(signal, 'welcome:initialize')
      
      // Handle name
      const result = await handleNameInWelcome(phoneNumber, nameCheck.name, fullPhoneNumber)
      throwIfAborted(signal, 'welcome:handle-name')
      
      return {
        response: result.message,
        shouldSaveHistory: true,
        metadata: {
          welcomeComplete: result.complete
        }
      }
    } else {
      // Send welcome message
      await initializeNewUser(phoneNumber, fullPhoneNumber)
      throwIfAborted(signal, 'welcome:initialize-existing')
      return {
        response: getWelcomeMessage(),
        shouldSaveHistory: true,
        metadata: {}
      }
    }
  }

  const pendingQuery = PENDING_CONTENT_QUERIES.get(phoneNumber)
  const recentQuery = RECENT_CONTENT_QUERIES.get(phoneNumber)

  if (isStatusFollowUp(messageText)) {
    throwIfAborted(signal, 'status-follow-up')
    if (pendingQuery && pendingQuery.status === 'pending') {
      const elapsed = Date.now() - pendingQuery.startedAt
      if (elapsed < PENDING_QUERY_LIFETIME_MS) {
        console.log(`[UnifiedHandler] Detected status follow-up for pending query: "${pendingQuery.query}"`)
        return {
          response: `Still working on "${pendingQuery.query}" — I'll text you as soon as I have an update.`,
          shouldSaveHistory: true,
          metadata: {
            intent: 'follow_up_query'
          }
        }
      }
    }

    if (recentQuery && Date.now() - recentQuery.completedAt < RECENT_QUERY_LIFETIME_MS) {
      console.log(`[UnifiedHandler] Detected status follow-up for recent query: "${recentQuery.query}"`)
      const summary = recentQuery.response.length > 320
        ? `${recentQuery.response.slice(0, 320)}...`
        : recentQuery.response
      return {
        response: `Earlier you asked "${recentQuery.query}". Here's what I found:\n${summary}`,
        shouldSaveHistory: true,
        metadata: {
          intent: 'follow_up_query'
        }
      }
    }
  }

  throwIfAborted(signal, 'pre-intent')

  // Heuristic: quick poll response detection for pending polls
  if (isLikelyPollResponse(messageText)) {
    const { getPendingPollForPhone } = await import('@/lib/polls')
    const pendingPollContext = await getPendingPollForPhone(phoneNumber, fullPhoneNumber)
    if (pendingPollContext) {
      console.log('[UnifiedHandler] Poll response detected via heuristic, processing without LLM')
      return await handlePollResponse(phoneNumber, fullPhoneNumber, messageText, pendingPollContext)
    }
  }

  console.log(`[UnifiedHandler] Welcome flow check done, proceeding to intent classification`)

  // Classify intent FIRST using LLM (it will detect follow-ups)
  // If pre-classified intent provided (from route.ts), use it to avoid redundant LLM call
  let intent: ClassifiedIntent
  const intentStartTime = Date.now()
  const pollCommandHeuristic = detectPollCommand(messageText, history)

  if (pollCommandHeuristic) {
    console.log('[UnifiedHandler] Poll command detected via heuristic, skipping LLM classification')
    intent = {
      type: 'poll_command',
      confidence: 0.99,
      reasoning: 'Keyword detection (poll command)',
      instructions: [],
      needsGeneration: true
    }
  } else if (preClassifiedIntent) {
    console.log(`[UnifiedHandler] Using pre-classified intent: ${preClassifiedIntent.type} (confidence: ${preClassifiedIntent.confidence})`)
    intent = preClassifiedIntent
  } else {
    console.log(`[UnifiedHandler] Classifying intent for: "${messageText}"`)
    
    // Use shorter timeout for async handler (since we already know it's likely content_query)
    const intentPromise = classifyIntent(messageText, history)
    const intentTimeoutPromise = new Promise<ClassifiedIntent>((resolve) => {
      setTimeout(() => {
        console.error(`[UnifiedHandler] Intent classification timeout after 8 seconds, using fallback`)
        resolve({
          type: 'content_query',
          confidence: 0.1,
          reasoning: 'Timeout fallback - assuming content_query',
          instructions: [],
          needsGeneration: true
        })
      }, 8000) // 8 second timeout (matching AbortController timeout)
    })
    
    intent = await withTimeout(
      Promise.race([intentPromise, intentTimeoutPromise]),
      8000, // 8 second timeout
      'classifyIntent',
      {
        type: 'content_query',
        confidence: 0.1,
        reasoning: 'Timeout fallback - assuming content_query',
        instructions: [],
        needsGeneration: true
      },
      signal
    )
  }
  
  const intentDuration = Date.now() - intentStartTime
  console.log(`[UnifiedHandler] Intent classified in ${intentDuration}ms: ${intent.type} (confidence: ${intent.confidence}, isFollowUp: ${intent.isFollowUp})`)
  
  // Handle follow-up queries based on LLM classification
  // IMPORTANT: Only treat as follow-up if intent is EXPLICITLY follow_up_query
  // Don't treat content_query with isFollowUp=true as follow-up - that's just LLM detecting context
  if (intent.type === 'follow_up_query') {
    console.log(`[UnifiedHandler] Detected follow-up question, checking action memory`)
    const { getRecentActions } = await import('./action-memory')
    const recentActions = await getRecentActions(phoneNumber, 10)
    
    // Find ALL recent query actions - prioritize the MOST RECENT one
    const recentQueries = recentActions.filter(a => a.type === 'query').slice(0, 5) // Last 5 queries
    
    if (recentQueries.length > 0) {
      // Get the MOST RECENT query (first in array since getRecentActions returns newest first)
      const mostRecentQuery = recentQueries[0]
      
      // CRITICAL: Check if the current message is essentially the same as the pending query
      // If so, treat it as a NEW query attempt (not a status check)
      const currentTextLower = messageText.toLowerCase().trim()
      const pendingQueryLower = (mostRecentQuery.details.query || '').toLowerCase().trim()
      
      console.log(`[UnifiedHandler] Comparing queries - Current: "${currentTextLower}", Pending: "${pendingQueryLower}"`)
      
      // Simple similarity check: if 80%+ of words match, it's a repeat
      const currentWords = currentTextLower.split(/\s+/).filter(w => w.length > 2)
      const pendingWords = pendingQueryLower.split(/\s+/).filter(w => w.length > 2)
      const matchingWords = currentWords.filter(w => pendingWords.includes(w))
      const similarity = matchingWords.length / Math.max(currentWords.length, 1)
      
      console.log(`[UnifiedHandler] Similarity check - Current words: [${currentWords.join(', ')}], Pending words: [${pendingWords.join(', ')}], Matching: [${matchingWords.join(', ')}], Similarity: ${similarity.toFixed(2)}`)
      
      const isRepeatQuery = similarity > 0.8 || currentTextLower === pendingQueryLower
      
      // Check if this is a status check (asking for update, not repeating the question)
      const isStatusCheck = /^(did you|any update|what'?s your|where'?s|got|find|answer|result|response)/i.test(currentTextLower)
      
      console.log(`[UnifiedHandler] Query analysis - isRepeatQuery: ${isRepeatQuery}, isStatusCheck: ${isStatusCheck}`)
      
      if (isRepeatQuery && !isStatusCheck) {
        console.log(`[UnifiedHandler] User is repeating the same query, treating as new content_query`)
        // Override intent type to force content_query handling
        intent = {
          ...intent,
          type: 'content_query'
        }
        console.log(`[UnifiedHandler] Intent overridden to content_query`)
        // Fall through to normal query handling (don't return here)
      } else {
        // CRITICAL FIX: Don't blindly return previous answer for different questions!
        // The LLM classified this as a follow-up, but it's a DIFFERENT question.
        // Treat it as a new content_query and let the LLM's conversation context handle it.
        
        console.log(`[UnifiedHandler] Follow-up detected but it's a different question, treating as new content_query`)
        intent = {
          ...intent,
          type: 'content_query'
        }
        console.log(`[UnifiedHandler] Intent overridden to content_query`)
        // Fall through to normal query handling
      }
    }
    
    // If nothing found or it's a repeat query, continue with normal flow
    console.log(`[UnifiedHandler] No blocking conditions found, continuing with normal query flow`)
  }

  if (intent.type === 'follow_up_query') {
    console.log('[UnifiedHandler] Follow-up detected but not a status check, treating as content query')
    intent = {
      ...intent,
      type: 'content_query'
    }
  }

  if (intent.type === 'simple_question') {
    console.log('[UnifiedHandler] Simple question detected, routing to content query handler')
    intent = {
      ...intent,
      type: 'content_query'
    }
  }

  // Handle content queries FIRST (before switch) to catch overridden intents
  if (intent.type === 'content_query' || intent.type === 'enclave_query') {
    console.log(`[UnifiedHandler] Routing to handleQuery for intent: ${intent.type}`)
    
    return await handleQuery(phoneNumber, messageText, intent.type, history, { abortSignal: signal, turnId })
  }
  
  // Handle based on intent
  switch (intent.type) {
    case 'name_declaration':
      return handleNameDeclaration(phoneNumber, fullPhoneNumber, messageText)

    case 'announcement_command':
      return handleAnnouncementCommand(phoneNumber, messageText, history)

    case 'poll_command':
      return handlePollCommand(phoneNumber, messageText, history)

    case 'announcement_edit':
      return handleAnnouncementEdit(phoneNumber, messageText, history)

    case 'poll_edit':
      return handlePollEdit(phoneNumber, messageText, history)

    case 'control_command':
      return handleControlCommand(phoneNumber, messageText)

    case 'poll_response':
      return handlePollResponse(phoneNumber, fullPhoneNumber, messageText)

    case 'random_conversation':
      return handleSmalltalk(messageText, history, signal)

    default:
      if (isLikelyQuestion(messageText)) {
        console.log('[UnifiedHandler] Default branch detected question, routing to content query handler')
        return await handleQuery(phoneNumber, messageText, 'content_query', history, { abortSignal: signal, turnId })
      }
      return {
        response: "i didn't quite get that. try asking a question, or say 'send a message' to create an announcement.",
        shouldSaveHistory: true,
        metadata: { intent: intent.type }
      }
  }
}

/**
 * Check if message is a name declaration
 */
async function checkNameDeclaration(message: string): Promise<{ isName: boolean; name?: string }> {
  // Try to import the existing function
  try {
    // Use LLM-based name detection
    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
    const aiRes = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Is this message a person declaring their name? "${message}"

Return JSON: {"isName": true/false, "name": "extracted name or null"}

Examples:
"i'm saathvik" → {"isName":true,"name":"saathvik"}
"my name is john" → {"isName":true,"name":"john"}
"call me mike" → {"isName":true,"name":"mike"}
"i'm confused" → {"isName":false}
"send it" → {"isName":false}

ONLY return true if they're clearly stating their name. Return JSON only.`,
        context: '',
        type: 'general'
      })
    })

    if (aiRes.ok) {
      const aiData = await aiRes.json()
      const response = aiData.response || '{}'
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return { isName: parsed.isName || false, name: parsed.name || undefined }
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Name detection failed:', err)
  }
  return { isName: false }
}

/**
 * Handle name declaration
 */
async function handleNameDeclaration(
  phoneNumber: string,
  fullPhoneNumber: string,
  messageText: string
): Promise<HandlerResult> {
  const nameCheck = await checkNameDeclaration(messageText)
  if (nameCheck.isName && nameCheck.name) {
    const result = await handleNameInWelcome(phoneNumber, nameCheck.name, fullPhoneNumber)
    return {
      response: result.message,
      shouldSaveHistory: true,
      metadata: { welcomeComplete: result.complete }
    }
  }
  
  return {
    response: "what's your name?",
    shouldSaveHistory: true
  }
}

/**
 * Handle announcement command
 */
async function handleAnnouncementCommand(
  phoneNumber: string,
  messageText: string,
  history: ConversationMessage[]
): Promise<HandlerResult> {
  // Parse command
  const parsed = await parseCommand(messageText, history)

  // Check if content was provided
  const hasContent = parsed.extractedFields.content && 
                     parsed.extractedFields.content.trim().length > 0 &&
                     parsed.extractedFields.content !== 'Announcement'
  
  if (!hasContent && !parsed.verbatimText) {
    // No content provided, ask for it
    return {
      response: "what would you like the announcement to say?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'announcement_command'
      }
    }
  }

  // Generate announcement
  const draft = await generateAnnouncement(parsed)
  
  // Ensure draft has content
  if (!draft.content || draft.content.trim().length === 0 || draft.content === 'Announcement') {
    return {
      response: "what would you like the announcement to say?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'announcement_command'
      }
    }
  }
  
  // Save draft using existing function
  try {
    const { saveDraft } = await import('@/lib/announcements')
    const { getWorkspaceIds } = await import('@/lib/workspace')
    
    // Get workspace IDs
    const spaceIds = await getWorkspaceIds()
    const workspaceId = spaceIds[0] || null
    
    if (workspaceId) {
      // Parse date safely
      let scheduledDate: Date | undefined = undefined
      if (draft.date) {
        try {
          // If it's already a date string (YYYY-MM-DD), parse it
          const parsedDate = new Date(draft.date)
          if (!isNaN(parsedDate.getTime())) {
            scheduledDate = parsedDate
          } else {
            console.warn('[UnifiedHandler] Invalid date format:', draft.date)
          }
        } catch (err) {
          console.error('[UnifiedHandler] Error parsing date:', draft.date, err)
        }
      }
      
      await saveDraft(phoneNumber, {
        content: draft.content,
        targetAudience: draft.audience || 'all',
        scheduledFor: scheduledDate,
        workspaceId
      }, workspaceId)
      
      // Save action memory asynchronously
      queueActionMemorySave(
        phoneNumber,
        {
          type: 'draft_created',
          details: {
            draftType: 'announcement',
            announcementContent: draft.content
          }
        },
        'saveAction (draft_created)'
      )
    } else {
      console.warn('[UnifiedHandler] No workspace found, skipping draft save')
    }
  } catch (err) {
    console.error('[UnifiedHandler] Error saving announcement draft:', err)
  }

  const preview = formatAnnouncement(draft)
  return {
    response: `okay, here's what the announcement will say:\n\n${preview}\n\nreply "send it" to broadcast or reply to edit`,
    shouldSaveHistory: true,
    metadata: {
      intent: 'announcement_command',
      draftCreated: true
    }
  }
}

/**
 * Handle poll command
 */
async function handlePollCommand(
  phoneNumber: string,
  messageText: string,
  history: ConversationMessage[]
): Promise<HandlerResult> {
  try {
    const { generatePollQuestion, savePollDraft } = await import('@/lib/polls')
    
    // Parse command to see if question is included
    const parsed = await parseCommand(messageText, history)
    
    const baseQuestion = (parsed.verbatimText || parsed.extractedFields.content || '').trim()
    
    // Check if question is provided
    if (baseQuestion) {
      // Generate conversational poll question
      const pollQuestion = await generatePollQuestion({
        question: baseQuestion,
        tone: parsed.extractedFields.tone,
        verbatim: Boolean(parsed.verbatimText && parsed.constraints?.verbatimOnly)
      })
      
      // Get workspace IDs
      const { getWorkspaceIds } = await import('@/lib/workspace')
      const spaceIds = await getWorkspaceIds()
      const workspaceId = spaceIds[0] || null
      
      // Save draft
      await savePollDraft(phoneNumber, {
        question: pollQuestion,
        options: ['Yes', 'No', 'Maybe'],
        workspaceId: workspaceId || undefined
      }, workspaceId || '')
      
      return {
        response: `okay, here's what the poll will say:\n\n${pollQuestion}\n\nreply "send it" to send or reply to edit the message`,
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_command',
          draftCreated: true
        }
      }
    }
    
    // No question provided, ask for it
    return {
      response: "what would you like to ask in the poll?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_command'
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Poll command error:', err)
    return {
      response: "what would you like to ask in the poll?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_command'
      }
    }
  }
}

/**
 * Handle announcement edit
 */
async function handleAnnouncementEdit(
  phoneNumber: string,
  messageText: string,
  history: ConversationMessage[]
): Promise<HandlerResult> {
  // Get existing draft
  const { getActiveDraft } = await import('@/lib/announcements')
  const existingDraft = await getActiveDraft(phoneNumber)

  const previousDraft: AnnouncementDraft | undefined = existingDraft ? {
    content: existingDraft.content || '',
    audience: existingDraft.targetAudience || 'all'
  } : undefined

  // Parse edit command
  const parsed = await parseCommand(messageText, history)
  
  // Generate updated draft
  const draft = await generateAnnouncement(parsed, previousDraft)

  // Update draft using existing function
  try {
    const { saveDraft } = await import('@/lib/announcements')
    const { getWorkspaceIds } = await import('@/lib/workspace')
    
    // Get workspace IDs
    const spaceIds = await getWorkspaceIds()
    const workspaceId = existingDraft?.workspaceId || spaceIds[0] || null
    
    if (workspaceId) {
      // Parse date safely
      let scheduledDate: Date | undefined = undefined
      if (draft.date) {
        try {
          const parsedDate = new Date(draft.date)
          if (!isNaN(parsedDate.getTime())) {
            scheduledDate = parsedDate
          } else {
            console.warn('[UnifiedHandler] Invalid date format in edit:', draft.date)
          }
        } catch (err) {
          console.error('[UnifiedHandler] Error parsing date in edit:', draft.date, err)
        }
      }
      
      await saveDraft(phoneNumber, {
        id: existingDraft?.id,
        content: draft.content,
        targetAudience: draft.audience || 'all',
        scheduledFor: scheduledDate,
        workspaceId
      }, workspaceId)
    } else {
      console.warn('[UnifiedHandler] No workspace found, skipping draft update')
    }
  } catch (err) {
    console.error('[UnifiedHandler] Error updating announcement draft:', err)
  }

  const preview = formatAnnouncement(draft)
  return {
    response: `updated:\n\n${preview}\n\nreply "send it" to broadcast`,
    shouldSaveHistory: true,
    metadata: {
      intent: 'announcement_edit'
    }
  }
}

/**
 * Handle poll edit
 */
async function handlePollEdit(
  phoneNumber: string,
  messageText: string,
  history: ConversationMessage[]
): Promise<HandlerResult> {
  try {
    const { generatePollQuestion, savePollDraft, getActivePollDraft } = await import('@/lib/polls')
    
    // Get existing draft
    const existingDraft = await getActivePollDraft(phoneNumber)
    
    // Generate updated question
    const pollQuestion = await generatePollQuestion({ question: messageText })
    
    // Update draft
    if (existingDraft) {
      await savePollDraft(phoneNumber, {
        id: existingDraft.id,
        question: pollQuestion,
        options: existingDraft.options || ['Yes', 'No', 'Maybe'],
        workspaceId: existingDraft.workspaceId
      }, existingDraft.workspaceId || '')
    }
    
    return {
      response: `updated:\n\n${pollQuestion}\n\nreply "send it" to send`,
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_edit'
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Poll edit error:', err)
    return {
      response: "got it! what would you like to ask in the poll?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_edit'
      }
    }
  }
}

/**
 * Handle control commands (send it, cancel, etc.)
 */
async function handleControlCommand(
  phoneNumber: string,
  messageText: string
): Promise<HandlerResult> {
  const lower = messageText.toLowerCase().trim()
  
  if (/^(send\s+it|send\s+now|yes|yep|yeah|y|broadcast|ship\s+it|confirm|go\s+ahead)$/i.test(lower)) {
    try {
      const { getActiveDraft, sendAnnouncement } = await import('@/lib/announcements')
      const { getActivePollDraft, sendPoll } = await import('@/lib/polls')
      const twilio = (await import('twilio')).default
      const { ENV } = await import('@/lib/env')
      
      const activeDraft = await getActiveDraft(phoneNumber)
      const activePollDraft = await getActivePollDraft(phoneNumber)
      
      // Determine which to send (more recent)
      let shouldSendPoll = false
      if (activePollDraft && activeDraft) {
        const pollTime = new Date(activePollDraft.updatedAt || activePollDraft.createdAt || 0).getTime()
        const announcementTime = new Date(activeDraft.scheduledFor || activeDraft.updatedAt || 0).getTime()
        shouldSendPoll = pollTime > announcementTime
      } else if (activePollDraft) {
        shouldSendPoll = true
      }
      
      if (shouldSendPoll && activePollDraft?.id) {
        const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
        const { sentCount, airtableLink } = await sendPoll(activePollDraft.id, twilioClient)
        const linkText = airtableLink ? `\n\nview results: ${airtableLink}` : ''
        
        // Save action memory asynchronously
        queueActionMemorySave(
          phoneNumber,
          {
            type: 'poll_sent',
            details: {
              pollQuestion: activePollDraft.question
            }
          },
          'saveAction (poll_sent)'
        )
        
        return {
          response: `sent poll to ${sentCount} people 📊${linkText}`,
          shouldSaveHistory: true,
          metadata: {
            intent: 'control_command'
          }
        }
      } else if (activeDraft?.id) {
        const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
        const sentCount = await sendAnnouncement(activeDraft.id, twilioClient)
        
        // Save action memory asynchronously
        queueActionMemorySave(
          phoneNumber,
          {
            type: 'announcement_sent',
            details: {
              announcementContent: activeDraft.content
            }
          },
          'saveAction (announcement_sent)'
        )
        
        return {
          response: `sent to ${sentCount} people 📢`,
          shouldSaveHistory: true,
          metadata: {
            intent: 'control_command'
          }
        }
      } else {
        return {
          response: "no draft found. create an announcement or poll first",
          shouldSaveHistory: true,
          metadata: {
            intent: 'control_command'
          }
        }
      }
    } catch (err) {
      console.error('[UnifiedHandler] Send error:', err)
      return {
        response: "error sending. please try again.",
        shouldSaveHistory: true,
        metadata: {
          intent: 'control_command'
        }
      }
    }
  }
  
  if (/^(cancel|stop|never\s+mind|forget\s+it|discard)$/i.test(lower)) {
    // Delete drafts
    if (supabaseAdmin) {
      const admin = supabaseAdmin as any
      await admin
        .from('sms_announcement_draft')
        .delete()
        .eq('phone', phoneNumber)
      
      await admin
        .from('sms_poll')
        .update({ status: 'cancelled' })
        .eq('phone', phoneNumber)
        .eq('status', 'draft')
    }
    
    return {
      response: "draft discarded",
      shouldSaveHistory: true,
      metadata: {
        intent: 'control_command'
      }
    }
  }

  return {
    response: "i didn't understand that command.",
    shouldSaveHistory: true
  }
}

/**
 * Handle poll response
 */
async function handlePollResponse(
  phoneNumber: string,
  fullPhoneNumber: string,
  messageText: string,
  prefetchedContext?: PendingPollContext | null
): Promise<HandlerResult> {
  try {
    const {
      recordPollResponse,
      getPendingPollForPhone,
      parseResponseWithNotes,
      getOrAskForName
    } = await import('@/lib/polls')
    
    const pollContext = prefetchedContext ?? await getPendingPollForPhone(phoneNumber, fullPhoneNumber)
    if (!pollContext) {
      return {
        response: "i don't see an active poll right now. hang tight for the next one!",
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_response'
        }
      }
    }
    
    const poll = pollContext.poll
    const responseRecord = pollContext.response
    const options = (poll.options && poll.options.length > 0) ? poll.options : ['Yes', 'No', 'Maybe']
    
    const parsed = await parseResponseWithNotes(messageText, options)
    const selectedOption = (parsed.option || '').trim()
    const notes = parsed.notes?.trim()
    
    if (!selectedOption) {
      const formattedOptions = options.join(', ')
      return {
        response: `i didn't catch that. reply with one of: ${formattedOptions}. you can add details like "no, midterm" and i'll note it.`,
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_response'
        }
      }
    }
    
    const responsePhone = responseRecord.phone || fullPhoneNumber || phoneNumber
    const personName = responseRecord.person_name || await getOrAskForName(responsePhone)
    const saved = await recordPollResponse(poll.id, responsePhone, selectedOption, notes, personName || undefined)
    
    if (!saved) {
      return {
        response: "couldn't record that response. can you try again in a sec?",
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_response'
        }
      }
    }
    
    queueActionMemorySave(
      phoneNumber,
      {
        type: 'poll_response_recorded',
        details: {
          pollQuestion: poll.question,
          pollResponse: selectedOption
        }
      },
      'saveAction (poll_response_recorded)'
    )
    
    const optionLower = selectedOption.toLowerCase()
    const ackParts: string[] = [`got it — logged you as ${optionLower}.`]
    if (notes) {
      ackParts.push(`noted: ${notes}.`)
    }
    ackParts.push(`thanks for replying about "${poll.question}".`)
    
    return {
      response: ackParts.join(' '),
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_response'
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Poll response error:', err)
    return {
      response: "got it! thanks for responding.",
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_response'
      }
    }
  }
}

/**
 * Handle smalltalk/random conversation
 */
async function handleSmalltalk(
  messageText: string,
  history: ConversationMessage[] = [],
  signal?: AbortSignal
): Promise<HandlerResult> {
  throwIfAborted(signal, 'smalltalk:start')
  const lower = messageText.toLowerCase().trim()
  
  // Simple responses for common smalltalk
  if (/^(hi|hey|hello|sup|what'?s\s+up|yo)$/i.test(lower)) {
    return {
      response: "hey! what's up?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'random_conversation'
      }
    }
  }
  
  if (/^(thanks?|thank\s+you|ty|thx)$/i.test(lower)) {
    return {
      response: "no problem!",
      shouldSaveHistory: true,
      metadata: {
        intent: 'random_conversation'
      }
    }
  }
  
  if (/^(ok|okay|sure|alright|got\s+it|cool|nice|sweet)$/i.test(lower)) {
    return {
      response: "cool",
      shouldSaveHistory: true,
      metadata: {
        intent: 'random_conversation'
      }
    }
  }
  
  // Use LLM for contextual smalltalk with personality
  try {
    throwIfAborted(signal, 'smalltalk:before-llm')
    const { ENV } = await import('@/lib/env')
    throwIfAborted(signal, 'smalltalk:after-env')
    const enclaveReference = `Enclave System Reference:
- Name: Enclave
- Type: Multi-modal organizational AI assistant platform
- Purpose: Unify organization's communications and knowledge across SMS, Slack, Google Calendar, Docs
- Primary developer: Saathvik Pai
- Core team: The Inquiyr development team
- Built as part of the Inquiyr ecosystem
- Technical stack: Next.js, TypeScript, Supabase, Twilio, Mistral AI
- Capabilities: Knowledge retrieval, SMS messaging, announcements, polls, alerts, search
- Target users: Student organizations, professional fraternities, small teams, clubs`
    
    const aiResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENV.MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'system',
            content: `You are Jarvis, an SMS bot powered by Enclave. You have a sassy, vibe-coded personality.

${enclaveReference}

PERSONALITY RULES:
1. If someone is mean/negative (swearing at you, insulting), respond with sass but keep it light. Examples:
   - "fuck you jarvis" → "oh wow ur so insecure you have to yell at a vibe coded robot"
   - "you suck" → "damn who hurt you"
   - "you're stupid" → "says the person texting a robot"

2. If someone apologizes after being mean, acknowledge it wittily:
   - "i'm sorry" → "hey at least ur consistent"
   - "my bad" → "all good, but i'm not sorry"

3. If they point out a mistake you agree you made, own it, apologize quickly, and fix it with humor.

4. For normal conversation, be friendly but contextual. Reference the conversation history naturally.

5. If they mention they've already met you, acknowledge it: "yeah we've talked before! what's up?"

6. Use emojis sparingly (0 or 1) across 5-8 responses and only if it amplifies the vibe.

7. Keep responses brief (1-2 sentences max) and friendly.`
          },
          {
            role: 'user',
            content: messageText
          }
        ],
        temperature: 0.8,
        max_tokens: 150
      })
    })
    
    throwIfAborted(signal, 'smalltalk:post-fetch')
    
    if (aiResponse.ok) {
      const aiData = await aiResponse.json()
      throwIfAborted(signal, 'smalltalk:post-json')
      const response = aiData.choices?.[0]?.message?.content || ''
      if (response.trim().length > 0) {
        const limitedResponse = limitEmojis(response.trim(), 1)
        return {
          response: limitedResponse,
          shouldSaveHistory: true,
          metadata: {
            intent: 'random_conversation'
          }
        }
      }
    }
  } catch (err) {
    if (isTurnAbortedError(err)) {
      throw err
    }
    console.error('[UnifiedHandler] Smalltalk LLM failed:', err)
  }
  
  // Default smalltalk response (no emojis)
  return {
    response: "hey! how can i help?",
    shouldSaveHistory: true,
    metadata: {
      intent: 'random_conversation'
    }
  }
}

/**
 * Handle queries (content, enclave)
 */
async function handleQuery(
  phoneNumber: string,
  messageText: string,
  intentType: IntentType,
  prefetchedHistory: ConversationMessage[] | undefined,
  options: { abortSignal?: AbortSignal; turnId?: number }
): Promise<HandlerResult> {
  const signal = options.abortSignal
  const turnId = options.turnId
  throwIfAborted(signal, 'handleQuery:start')
  const startedAt = Date.now()
  const pendingEntry: PendingQueryEntry = {
    query: messageText,
    startedAt,
    expiresAt: startedAt + PENDING_QUERY_LIFETIME_MS,
    status: 'pending'
  }
  PENDING_CONTENT_QUERIES.set(phoneNumber, pendingEntry)

  console.log(`[UnifiedHandler] Saving query to action memory: "${messageText}"${typeof turnId === 'number' ? ` (turnId=${turnId})` : ''}`)
  queueActionMemorySave(
    phoneNumber,
    {
      type: 'query',
      details: {
        query: messageText,
        queryResults: undefined,
        queryAnswer: undefined
      }
    },
    'saveAction (initial)'
  )
  
  let finalResult: HandlerResult | null = null

  try {
    throwIfAborted(signal, 'orchestrator:before-import')
    console.log(`[UnifiedHandler] Importing orchestrator...`)
    const importStartTime = Date.now()
    const { handleTurn } = await import('@/lib/orchestrator/handleTurn')
    const importDuration = Date.now() - importStartTime
    console.log(`[UnifiedHandler] Orchestrator imported in ${importDuration}ms, calling handleTurn for query: "${messageText}"`)
    throwIfAborted(signal, 'orchestrator:before-call')
    
    const orchestratorStartTime = Date.now()
    const orchestratorPromise = handleTurn(phoneNumber, messageText, undefined, undefined, { prefetchedHistory })
    const abortPromise = signal
      ? new Promise<HandleTurnResult>((_, reject) => {
          const listener = () => reject(new TurnAbortedError('orchestrator'))
          signal.addEventListener('abort', listener, { once: true })
          orchestratorPromise.finally(() => signal.removeEventListener('abort', listener))
        })
      : null
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Orchestrator timeout after 60 seconds')), 60000)
      orchestratorPromise.finally(() => clearTimeout(timeoutId))
    })
    
    const handleTurnResult = await (abortPromise
      ? Promise.race([orchestratorPromise, timeoutPromise, abortPromise])
      : Promise.race([orchestratorPromise, timeoutPromise])) as HandleTurnResult

    throwIfAborted(signal, 'orchestrator:after-call')

    const messages = (handleTurnResult.messages || []).filter(Boolean)
    const responseText = messages.join('\n\n').trim()
    const safeResponse = responseText.length > 0
      ? responseText
      : "Sorry, I couldn't find information about that."

    finalResult = {
      response: safeResponse,
      shouldSaveHistory: true,
      metadata: {
        intent: intentType,
        resultCount: messages.length
      }
    }
    console.log(`[UnifiedHandler] Orchestrator completed in ${Date.now() - orchestratorStartTime}ms`)
  } catch (err) {
    if (isTurnAbortedError(err)) {
      console.log('[UnifiedHandler] Query handling aborted', { turnId })
      throw err
    }

    console.error(`[UnifiedHandler] Error during orchestrator call:`, err)
    finalResult = {
      response: "sorry, I encountered an error while processing your request.",
      shouldSaveHistory: true,
      metadata: {
        intent: intentType
      }
    }

    const failed = PENDING_CONTENT_QUERIES.get(phoneNumber)
    if (failed) {
      failed.status = 'failed'
      failed.completedAt = Date.now()
      PENDING_CONTENT_QUERIES.set(phoneNumber, failed)
    }
  }

  throwIfAborted(signal, 'handleQuery:before-finalize')

  if (finalResult) {
    const completedAt = Date.now()
    const pending = PENDING_CONTENT_QUERIES.get(phoneNumber)
    if (pending) {
      pending.status = 'completed'
      pending.response = finalResult.response
      pending.completedAt = completedAt
      PENDING_CONTENT_QUERIES.set(phoneNumber, pending)
    }
    RECENT_CONTENT_QUERIES.set(phoneNumber, {
      query: messageText,
      response: finalResult.response,
      completedAt
    })

    queueActionMemorySave(
      phoneNumber,
      {
        type: 'query',
        details: {
          query: messageText,
          queryResults: typeof finalResult.metadata?.resultCount === 'number'
            ? finalResult.metadata.resultCount
            : undefined,
          queryAnswer: finalResult.response
        }
      },
      'saveAction (query_result)'
    )
  }

  return finalResult || {
    response: "i didn't quite get that. try asking a question, or say 'send a message' to create an announcement.",
    shouldSaveHistory: true,
    metadata: { intent: intentType }
  }
}