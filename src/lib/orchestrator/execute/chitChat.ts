import { TurnFrame, ContextEnvelope, ExecuteResult } from './index'

const smalltalkResponses: Record<string, string> = {
  'thanks?': 'you\'re welcome! 😊',
  'thank you': 'you\'re welcome! 😊',
  'ty': 'np! 😊',
  'thx': 'np! 😊',
  'hi': 'hey! what\'s up?',
  'hey': 'hey! what\'s up?',
  'hello': 'hey! what\'s up?',
  'ok': 'cool 👍',
  'okay': 'cool 👍',
  'alright': 'sounds good 👍',
  'sure': 'cool 👍',
  'got it': 'awesome 👍',
}

export async function executeChitChat(
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  const lowerMsg = frame.text.toLowerCase().trim()
  const query = frame.text
  
  // Handle abusive messages
  if (frame.signals.toxicity === 'abusive') {
    return {
      messages: ['✋ Let\'s keep it respectful. Reply \'help\' for what I can do.']
    }
  }
  
  // Handle cancel commands
  if (frame.signals.command === 'CANCEL') {
    // TODO: Actually delete the draft
    return {
      messages: ['draft discarded'],
      newMode: 'IDLE'
    }
  }
  
  // Check if user is asking about past actions
  const isActionQuery = /^(did\s+you|why\s+didn'?t|have\s+you|what\s+did\s+you)/i.test(query)
  if (isActionQuery && envelope.evidence) {
    const actionMemory = envelope.evidence.find(e => e.scope === 'ACTION' && e.source_id?.includes('action_memory'))
    if (actionMemory?.text) {
      // Use AI to answer based on action memory
      try {
        const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000)
        
        const aiRes = await fetch(aiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            context: actionMemory.text,
            type: 'summary'
          }),
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)
        
        if (aiRes.ok) {
          const aiData = await aiRes.json()
          const response = aiData.response || ''
          if (response.length > 10) {
            return {
              messages: [response]
            }
          }
        }
      } catch (err) {
        console.error(`[ChitChat] AI call for action query failed:`, err)
      }
    }
  }
  
  // Handle smalltalk
  const response = smalltalkResponses[lowerMsg] || '👍'
  
  // Add draft follow-up if draft exists
  let draftFollowUp = ''
  if (envelope.system_state.pending_draft) {
    if (envelope.system_state.pending_draft.kind === 'announcement') {
      draftFollowUp = `\n\nbtw you have an announcement draft ready - reply "send it" to send`
    } else {
      draftFollowUp = `\n\nbtw you have a poll draft ready: "${envelope.system_state.pending_draft.question}" - reply "send it" to send`
    }
  }
  
  return {
    messages: [`${response}${draftFollowUp}`]
  }
}

