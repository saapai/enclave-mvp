import { TurnFrame, ContextEnvelope, ExecuteResult } from './index'
import { extractPollDetails, generatePollQuestion } from '@/lib/polls'
import { savePollDraft } from '@/lib/polls'
import { getWorkspaceIds } from '@/lib/workspace'
import { normalizePhone } from '../frame'

export async function executePollCreate(
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  const normalizedPhone = normalizePhone(frame.user.id)
  const spaceIds = await getWorkspaceIds()
  
  // Extract poll details
  const details = await extractPollDetails(frame.text)
  let question = details.question || ''
  
  // Check for quoted text - if present, use it verbatim (don't pass through generatePollQuestion)
  let draftQuestion: string
  if (frame.signals.quoted.length > 0) {
    // Use quoted text verbatim - preserve exact wording
    draftQuestion = frame.signals.quoted[0]
  } else if (!question || question.trim().length === 0) {
    // If no question, ask for it
    const askMsg = 'what would you like to ask in the poll?'
    
    const { supabase } = await import('@/lib/supabase')
    await supabase.from('sms_conversation_history').insert({
      phone_number: normalizedPhone,
      user_message: frame.text,
      bot_response: askMsg
    })
    
    return {
      messages: [askMsg],
      newMode: 'POLL_INPUT'
    }
  } else {
    // Generate conversational question only if no quotes
    draftQuestion = await generatePollQuestion({ question, tone: details.tone || 'casual' })
  }
  
  // Save draft
  await savePollDraft(normalizedPhone, {
    question: draftQuestion,
    options: details.options || ['Yes', 'No', 'Maybe'],
    tone: details.tone,
    workspaceId: spaceIds[0]
  }, spaceIds[0])
  
  return {
    messages: [`okay here's what the poll will say:\n\n${draftQuestion}\n\nreply "send it" to send or reply to edit the message`],
    newMode: 'POLL_INPUT'
  }
}

