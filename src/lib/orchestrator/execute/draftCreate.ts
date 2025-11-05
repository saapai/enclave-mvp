import { TurnFrame, ContextEnvelope, ExecuteResult } from './index'
import { generateAnnouncementDraft, extractAnnouncementDetails, extractRawAnnouncementText } from '@/lib/announcements'
import { saveDraft } from '@/lib/announcements'
import { getWorkspaceIds } from '@/lib/workspace'
import { normalizePhone } from '../frame'

export async function executeDraftCreate(
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  const normalizedPhone = normalizePhone(frame.user.id)
  const spaceIds = await getWorkspaceIds()
  
  // Extract announcement details
  const details = await extractAnnouncementDetails(frame.text)
  
  // Check for quoted text
  const quoteMatch = frame.text.match(/"([^"]+)"/)
  let announcementContent = details.content || ''
  if (quoteMatch) {
    announcementContent = quoteMatch[1]
  }
  
  // If no content, ask for it
  if (!announcementContent || announcementContent.trim().length === 0) {
    const askMsg = 'what would you like the announcement to say?'
    
    // Save to conversation history
    const { supabase } = await import('@/lib/supabase')
    await supabase.from('sms_conversation_history').insert({
      phone_number: normalizedPhone,
      user_message: frame.text,
      bot_response: askMsg
    })
    
    return {
      messages: [askMsg],
      newMode: 'ANNOUNCEMENT_INPUT'
    }
  }
  
  // Generate draft
  const draft = await generateAnnouncementDraft({ ...details, content: announcementContent })
  
  // Save draft
  await saveDraft(normalizedPhone, {
    content: draft,
    tone: details.tone || 'casual',
    scheduledFor: details.scheduledFor ? new Date(details.scheduledFor) : undefined,
    targetAudience: details.targetAudience,
    workspaceId: spaceIds[0]
  }, spaceIds[0])
  
  const response = details.scheduledFor
    ? `okay here's what the announcement will say:\n\n${draft}\n\nscheduled for ${new Date(details.scheduledFor).toLocaleString()}. reply to edit or "send now" to send immediately`
    : `okay here's what the announcement will say:\n\n${draft}\n\nreply "send it" to broadcast or reply to edit the message`
  
  return {
    messages: [response],
    newMode: 'ANNOUNCEMENT_INPUT'
  }
}

