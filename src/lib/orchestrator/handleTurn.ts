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
  orgId?: string
): Promise<HandleTurnResult> {
  try {
    // 1. Build TurnFrame
    const frame = await buildTurnFrame(phoneNumber, text, userId, orgId)
    
    // 2. Plan (determine ResponseMode)
    const mode = plan(frame)
    console.log(`[Orchestrator] Frame mode: ${frame.state.mode}, Planned mode: ${mode}`)
    
    // 3. Build ContextEnvelope
    const envelope = await buildEnvelope(frame, mode, orgId)
    
    // 4. Execute
    const result = await execute(mode, frame, envelope)
    
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
      await supabase.from('sms_conversation_history').insert({
        phone_number: normalizedPhone,
        user_message: text,
        bot_response: result.messages.join('\n\n') || 'No response generated'
      })
    } catch (err) {
      console.error(`[Orchestrator] Failed to save conversation history:`, err)
    }
    
    // 6. Ensure we always have at least one message
    if (!result.messages || result.messages.length === 0) {
      console.error(`[Orchestrator] ERROR: Empty messages array, using fallback`)
      result.messages = ['I couldn\'t process that request. Please try again.']
    }
    
    // 6. Return result
    return result
  } catch (error) {
    console.error(`[Orchestrator] Error handling turn:`, error)
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

