/**
 * Conversation Snapshot Retriever
 * 
 * Retrieves last ~10 messages, extracts entities, detects unresolved intents.
 */

import { supabase, supabaseAdmin } from '@/lib/supabase'
import { EvidenceUnit } from './types'

/**
 * Normalize phone number (same as SMS route)
 */
function normalizePhone(phone: string): string {
  const cleaned = String(phone).replace(/[^\d]/g, '')
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    return cleaned.substring(1)
  }
  return cleaned.slice(-10)
}

/**
 * Retrieve conversation snapshot
 */
export async function retrieveConvoSnapshot(phoneNumber: string, maxMessages: number = 10): Promise<EvidenceUnit[]> {
  const normalizedPhone = normalizePhone(phoneNumber)
  const client = supabaseAdmin || supabase

  if (!client) {
    console.error('[ConvoSnapshot] No Supabase client available')
    return []
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
      console.error('[ConvoSnapshot] Conversation history query timed out after 3000ms')
    }, 3000)

    const { data: messages, error } = await client
      .from('sms_conversation_history')
      .select('user_message, bot_response, created_at')
      .eq('phone_number', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(maxMessages)
      .abortSignal(controller.signal)

    clearTimeout(timeoutId)

    if (error) {
      console.error('[ConvoSnapshot] Failed to load conversation history:', error)
      return []
    }

    if (!messages || messages.length === 0) {
      return []
    }
  
  // Build conversation context
  const conversationText = messages
    .reverse() // chronological order
    .map(m => `User: ${m.user_message}\nBot: ${m.bot_response}`)
    .join('\n\n')
  
  // Extract simple entities (names, dates, times mentioned)
  const entities: string[] = []
  const lastUserMessage = messages[messages.length - 1]?.user_message || ''
  const lastBotMessage = messages[messages.length - 1]?.bot_response || ''
  
  // Extract quoted text
  const quotedMatches = lastUserMessage.match(/"([^"]+)"/g)
  if (quotedMatches) {
    entities.push(...quotedMatches.map((m: string) => m.slice(1, -1)))
  }
  
  // Extract time references
  const timeMatches = lastUserMessage.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)/gi)
  if (timeMatches) {
    entities.push(...timeMatches)
  }
  
  // Extract date references
  const dateMatches = lastUserMessage.match(/(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi)
  if (dateMatches) {
    entities.push(...dateMatches)
  }
  
  // Detect unresolved intent (user asked something but bot didn't fully answer)
  const hasQuestion = lastUserMessage.includes('?')
  const hasUnresolvedIntent = hasQuestion && lastBotMessage.length < 50
  
  const evidence: EvidenceUnit = {
    scope: 'CONVO',
    source_id: `convo_${normalizedPhone}`,
    text: `Conversation context:\n${conversationText}\n\n${entities.length > 0 ? `Entities: ${entities.join(', ')}\n` : ''}${hasUnresolvedIntent ? 'Unresolved intent detected' : ''}`,
    ts: messages[messages.length - 1]?.created_at || new Date().toISOString(),
    acl_ok: true,
    scores: {
      semantic: 0.9,
      keyword: 0.8,
      freshness: 1.0, // Always fresh - it's the current conversation
      role_match: 1.0
    }
  }
  
  return [evidence]
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[ConvoSnapshot] Conversation history query aborted due to timeout')
    } else {
      console.error('[ConvoSnapshot] Unexpected error retrieving conversation snapshot:', err)
    }
    return []
  }
}

