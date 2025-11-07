/**
 * Session Handler
 * 
 * Main entry point that ties together router, reducer, and preview.
 * Handles conversation turns with state machine guardrails.
 */

import { SessionState, Intent, Message } from './types'
import { route } from './router'
import { reduce, initializeState } from './reducer'
import { renderConfirmation, renderDiff, renderPreview } from './preview'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * Load session state from database
 */
export async function loadSessionState(phoneNumber: string): Promise<SessionState> {
  try {
    if (!supabaseAdmin) {
      console.error('[Session] supabaseAdmin is null')
      return initializeState()
    }
    
    const { data, error } = await supabaseAdmin
      .from('sms_session_state')
      .select('*')
      .eq('phone', phoneNumber)
      .maybeSingle()
    
    if (error || !data) {
      return initializeState()
    }
    
    return JSON.parse(data.state_json)
  } catch (err) {
    console.error('[Session] Failed to load state:', err)
    return initializeState()
  }
}

/**
 * Save session state to database
 */
export async function saveSessionState(phoneNumber: string, state: SessionState): Promise<void> {
  try {
    if (!supabaseAdmin) {
      console.error('[Session] supabaseAdmin is null')
      return
    }
    
    await supabaseAdmin
      .from('sms_session_state')
      .upsert({
        phone: phoneNumber,
        state_json: JSON.stringify(state),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'phone'
      })
  } catch (err) {
    console.error('[Session] Failed to save state:', err)
  }
}

/**
 * Load conversation history window (last N messages)
 */
export async function loadHistoryWindow(phoneNumber: string, limit: number = 10): Promise<Message[]> {
  try {
    if (!supabaseAdmin) {
      console.error('[Session] supabaseAdmin is null')
      return []
    }
    
    const { data } = await supabaseAdmin
      .from('sms_conversation_history')
      .select('id, user_message, bot_response, created_at')
      .eq('phone_number', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(limit)
    
    if (!data) return []
    
    // Convert to Message format
    const messages: Message[] = []
    for (const row of data.reverse()) {
      if (row.user_message) {
        messages.push({
          id: `${row.id}_user`,
          role: 'user',
          text: row.user_message,
          timestamp: row.created_at
        })
      }
      if (row.bot_response) {
        messages.push({
          id: `${row.id}_bot`,
          role: 'bot',
          text: row.bot_response,
          timestamp: row.created_at
        })
      }
    }
    
    return messages
  } catch (err) {
    console.error('[Session] Failed to load history:', err)
    return []
  }
}

/**
 * Handle a conversation turn
 */
export async function handleTurn(
  phoneNumber: string,
  messageText: string
): Promise<{ response: string; state: SessionState }> {
  console.log(`[Session] Handling turn for ${phoneNumber}: "${messageText}"`)
  
  // Load current state
  const currentState = await loadSessionState(phoneNumber)
  console.log(`[Session] Current mode: ${currentState.mode}, has draft: ${!!currentState.draft}`)
  
  // Load history for context
  const historyWindow = await loadHistoryWindow(phoneNumber)
  
  // Route the message to get intent
  const intent = await route(messageText, historyWindow.map(m => m.text))
  console.log(`[Session] Intent: type=${intent.type}, mode_transition=${intent.mode_transition}, is_control=${intent.is_control_command}`)
  
  // Store old draft for diff
  const oldDraft = currentState.draft
  
  // Reduce state based on intent
  const newState = reduce(currentState, intent, messageText)
  console.log(`[Session] New mode: ${newState.mode}, has draft: ${!!newState.draft}`)
  
  // Save state
  await saveSessionState(phoneNumber, newState)
  
  // Generate response based on new state
  let response = ''
  
  // Handle sending
  if (newState.mode === 'sending' && newState.draft) {
    response = `sent to X people 📢` // TODO: actual sending logic
    // Clear draft after sending
    newState.draft = null
    newState.mode = 'idle'
    await saveSessionState(phoneNumber, newState)
  }
  // Handle cancel
  else if (newState.mode === 'idle' && intent.is_control_command && oldDraft) {
    response = 'draft discarded'
  }
  // Handle confirming mode
  else if (newState.mode === 'confirming' && newState.draft) {
    response = renderConfirmation(newState.draft)
  }
  // Handle editing mode - show updated preview
  else if (newState.mode === 'editing' && newState.draft) {
    if (oldDraft) {
      response = renderDiff(oldDraft, newState.draft)
    } else {
      response = `updated:\n\n${renderPreview(newState.draft)}\n\nreply "send it" to broadcast`
    }
  }
  // Handle drafting mode - show initial preview
  else if (newState.mode === 'drafting' && newState.draft) {
    response = `okay here's what the ${newState.draft.type} will say:\n\n${renderPreview(newState.draft)}\n\nreply "send it" to broadcast or reply to edit`
  }
  // Handle query - this is a side_chat, so answer but don't change mode
  else if (intent.type === 'query') {
    // TODO: Actually answer the query
    response = '[query response would go here]'
  }
  // Handle smalltalk
  else if (intent.type === 'smalltalk') {
    response = '👍'
  }
  // Default fallback
  else {
    response = 'i didn\'t quite get that. try "send a message" to create an announcement or "make a poll" to create a poll'
  }
  
  console.log(`[Session] Response: "${response}"`)
  
  return { response, state: newState }
}

