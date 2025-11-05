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

