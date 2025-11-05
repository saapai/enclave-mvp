import { TurnFrame, ContextEnvelope, ExecuteResult } from './index'

export async function executeActionConfirm(
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  const pending = envelope.system_state.pending_draft || envelope.system_state.pending_poll
  
  if (!pending) {
    return {
      messages: ['No draft found to send.']
    }
  }
  
  if (pending.kind === 'announcement') {
    return {
      messages: [`Ready to send:\n\n${pending.body}\n\nReply "send it" to broadcast or reply to edit`],
      newMode: 'CONFIRM_SEND'
    }
  } else {
    return {
      messages: [`Ready to send:\n\n${pending.question}\n\nReply "send it" to send or reply to edit`],
      newMode: 'CONFIRM_SEND'
    }
  }
}

