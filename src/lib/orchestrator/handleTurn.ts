/**
 * Handle Turn
 * 
 * Main orchestrator entry point: build frame → plan → envelope → execute → emit
 */

import { buildTurnFrame } from './frame'
import { plan } from './plan'
import { buildEnvelope } from './envelope'
import { execute } from './execute'
import { splitLongMessage } from '@/lib/text/limits'
import { supabase } from '@/lib/supabase'

import { normalizePhone } from './frame'

export interface HandleTurnResult {
  messages: string[]
  newMode?: 'IDLE' | 'ANNOUNCEMENT_INPUT' | 'POLL_INPUT' | 'CONFIRM_SEND'
}

/**
 * Handle a single SMS turn using the orchestrator
 */
export async function handleTurn(
  phoneNumber: string,
  text: string,
  userId?: string,
  orgId?: string,
  options?: { prefetchedHistory?: ConversationMessage[] }
): Promise<HandleTurnResult> {
  const overallStart = Date.now()
  const textPreview = text.length > 80 ? `${text.substring(0, 77)}...` : text
  console.log(`[Orchestrator] handleTurn start for ${phoneNumber}: "${textPreview}"`)
  try {
    // 1. Build TurnFrame
    let stepStart = Date.now()
    const frame = await buildTurnFrame(phoneNumber, text, userId, orgId, options?.prefetchedHistory)
    console.log(`[Orchestrator] buildTurnFrame completed in ${Date.now() - stepStart}ms`)
    
    // 2. Plan (determine ResponseMode)
    stepStart = Date.now()
    const mode = plan(frame)
    console.log(`[Orchestrator] plan() completed in ${Date.now() - stepStart}ms (frame mode=${frame.state.mode}, planned mode=${mode})`)
    
    // 3. Build ContextEnvelope
    stepStart = Date.now()
    const envelope = await buildEnvelope(frame, mode, orgId)
    console.log(`[Orchestrator] buildEnvelope completed in ${Date.now() - stepStart}ms`)
    
    // 4. Execute
    stepStart = Date.now()
    const result = await execute(mode, frame, envelope)
    console.log(`[Orchestrator] execute(${mode}) completed in ${Date.now() - stepStart}ms`)
    
    // Log result for debugging
    console.log(`[Orchestrator] Execute result: ${result.messages.length} messages, mode=${mode}`)
    if (result.messages.length > 0) {
      console.log(`[Orchestrator] First message preview: "${result.messages[0].substring(0, 100)}..."`)
    } else {
      console.error(`[Orchestrator] WARNING: No messages in result!`)
    }
    
    // 5. Log decision
    const normalizedPhone = normalizePhone(phoneNumber)
    try {
      stepStart = Date.now()
      await supabase.from('sms_conversation_history').insert({
        phone_number: normalizedPhone,
        user_message: text,
        bot_response: result.messages.join('\n\n') || 'No response generated'
      })
      console.log(`[Orchestrator] Saved conversation history in ${Date.now() - stepStart}ms`)
    } catch (err) {
      console.error(`[Orchestrator] Failed to save conversation history:`, err)
    }
    
    // 6. Ensure we always have at least one message
    if (!result.messages || result.messages.length === 0) {
      console.error(`[Orchestrator] ERROR: Empty messages array, using fallback`)
      result.messages = ['I couldn\'t process that request. Please try again.']
    }
    
    // 6. Return result
    console.log(`[Orchestrator] handleTurn success for ${phoneNumber} in ${Date.now() - overallStart}ms`)
    return result
  } catch (error) {
    console.error(`[Orchestrator] Error handling turn:`, error)
    console.error(`[Orchestrator] handleTurn failed after ${Date.now() - overallStart}ms`)
    return {
      messages: ['I encountered an error processing your request. Please try again.']
    }
  }
}

/**
 * Convert HandleTurnResult to TwiML
 */
export function toTwiml(messages: string[]): string {
  if (messages.length === 0) {
    messages = ['I couldn\'t process that request.']
  }
  
  // Split long messages
  const allMessages: string[] = []
  for (const msg of messages) {
    const split = splitLongMessage(msg, 1600)
    allMessages.push(...split)
  }
  
  if (allMessages.length === 1) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${allMessages[0]}</Message>
</Response>`
  }
  
  const messageXml = allMessages.map(msg => `  <Message>${msg}</Message>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${messageXml}
</Response>`
}

