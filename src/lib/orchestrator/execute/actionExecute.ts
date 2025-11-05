import { TurnFrame, ContextEnvelope, ExecuteResult } from './index'
import { sendAnnouncement } from '@/lib/announcements'
import { sendPoll } from '@/lib/polls'
import twilio from 'twilio'
import { ENV } from '@/lib/env'
import { normalizePhone } from '../frame'

export async function executeActionExecute(
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  const pending = envelope.system_state.pending_draft || envelope.system_state.pending_poll
  
  if (!pending) {
    return {
      messages: ['No draft found to send.']
    }
  }
  
  const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
  
  try {
    if (pending.kind === 'announcement') {
      const sentCount = await sendAnnouncement(pending.id, twilioClient)
      return {
        messages: [`sent to ${sentCount} people 📢`],
        newMode: 'IDLE'
      }
    } else {
      const { sentCount, airtableLink } = await sendPoll(pending.id, twilioClient)
      const linkText = airtableLink ? `\n\nview results: ${airtableLink}` : ''
      return {
        messages: [`sent poll to ${sentCount} people 📊${linkText}`],
        newMode: 'IDLE'
      }
    }
  } catch (error) {
    console.error(`[Execute Action] Error sending:`, error)
    return {
      messages: ['Failed to send. Please try again.']
    }
  }
}

