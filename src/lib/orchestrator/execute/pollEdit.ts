import { TurnFrame, ContextEnvelope, Draft, ExecuteResult } from './index'
import { savePollDraft } from '@/lib/polls'
import { extractRawAnnouncementText } from '@/lib/announcements'
import { getWorkspaceIds } from '@/lib/workspace'
import { normalizePhone } from '../frame'

export async function executePollEdit(
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  const pending = envelope.system_state.pending_draft
  
  if (!pending || pending.kind !== 'poll') {
    return {
      messages: ['No poll draft found.']
    }
  }
  
  const normalizedPhone = normalizePhone(frame.user.id)
  const spaceIds = await getWorkspaceIds()
  
  // Use quoted text if available, otherwise extract raw
  let question = pending.question || ''
  
  if (frame.signals.quoted.length > 0) {
    question = frame.signals.quoted[0]
  } else {
    const extracted = extractRawAnnouncementText(frame.text)
    if (extracted && extracted.length > 0) {
      question = extracted
    } else {
      // Use intelligent patching (simple append for now)
      question = `${pending.question} ${frame.text}`.trim()
    }
  }
  
  // Save draft
  await savePollDraft(normalizedPhone, {
    id: pending.id,
    question,
    options: pending.options || ['Yes', 'No', 'Maybe'],
    tone: 'casual',
    workspaceId: spaceIds[0]
  }, spaceIds[0])
  
  return {
    messages: [`updated:\n\n${question}\n\nreply "send it" to send`],
    newMode: 'POLL_INPUT'
  }
}

