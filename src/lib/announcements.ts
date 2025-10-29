/**
 * Announcement Handler
 * Manages announcement drafting, editing, and scheduling via SMS
 */

import { supabase } from './supabase';

export interface AnnouncementDraft {
  id?: string;
  content: string;
  tone?: string;
  scheduledFor?: Date;
  targetAudience?: string;
  workspaceId?: string;
}

/**
 * Detect if message is an announcement request
 */
export function isAnnouncementRequest(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return (
    lowerMsg.includes('create an announcement') ||
    lowerMsg.includes('send an announcement') ||
    lowerMsg.includes('make an announcement') ||
    lowerMsg.includes('announce') ||
    lowerMsg.includes('send announcement') ||
    lowerMsg.includes('broadcast')
  );
}

/**
 * Detect if message is modifying a draft
 */
export function isDraftModification(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return (
    lowerMsg.includes('be meaner') ||
    lowerMsg.includes('be nicer') ||
    lowerMsg.includes('be more urgent') ||
    lowerMsg.includes('be more casual') ||
    lowerMsg.includes('change it to') ||
    lowerMsg.includes('make it') ||
    lowerMsg.includes('edit')
  );
}

/**
 * Extract announcement details from message using LLM
 */
export async function extractAnnouncementDetails(message: string): Promise<{
  content?: string;
  scheduledFor?: string;
  tone?: string;
  targetAudience?: string;
}> {
  try {
    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`;
    const aiRes = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Extract announcement details from this message: "${message}"
        
Return JSON with these fields:
- content: the message to announce (string)
- scheduledFor: when to send it (ISO date/time or null for immediate)
- tone: the tone (neutral/urgent/casual/mean or null)
- targetAudience: who to send to (all/actives/pledges or null)

Example: "create an announcement telling actives to come to meeting tonight at 8"
Response: {"content":"active meeting tonight at 8pm","scheduledFor":null,"tone":"neutral","targetAudience":"actives"}

Only return valid JSON, nothing else.`,
        context: '',
        type: 'general'
      })
    });

    if (aiRes.ok) {
      const aiData = await aiRes.json();
      const response = aiData.response || '{}';
      
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  } catch (err) {
    console.error('[Announcements] Failed to extract details:', err);
  }
  
  return {};
}

/**
 * Generate announcement draft based on details
 */
export async function generateAnnouncementDraft(
  details: { content?: string; tone?: string; targetAudience?: string },
  previousDraft?: string
): Promise<string> {
  try {
    const toneInstructions: Record<string, string> = {
      mean: "be direct and add 'or else' at the end",
      urgent: "make it urgent with urgency words like 'ASAP' or 'mandatory'",
      casual: "make it casual and friendly, like texting a friend",
      neutral: "keep it straightforward and informative"
    };

    const tone = details.tone || 'casual';
    const toneInstruction = toneInstructions[tone] || toneInstructions.neutral;

    const prompt = previousDraft
      ? `Modify this announcement to ${toneInstruction}:

Original: "${previousDraft}"

New announcement (keep it under 160 chars, no caps at start, natural like a text):`
      : `Write an announcement for: "${details.content}"

Style: ${toneInstruction}
Keep it under 160 chars, no caps at start of sentences, natural like texting a friend.

Announcement:`;

    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`;
    const aiRes = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: prompt,
        context: '',
        type: 'general'
      })
    });

    if (aiRes.ok) {
      const aiData = await aiRes.json();
      let draft = aiData.response || details.content || 'announcement';
      
      // Remove quotes if present
      draft = draft.replace(/^["']|["']$/g, '');
      
      // Ensure first char is lowercase unless it's an acronym
      if (draft.length > 0 && draft[0] === draft[0].toUpperCase() && draft[0] !== draft[0].toLowerCase()) {
        if (!draft.match(/^[A-Z]{2,}/)) { // Not an all-caps acronym
          draft = draft[0].toLowerCase() + draft.substring(1);
        }
      }
      
      return draft;
    }
  } catch (err) {
    console.error('[Announcements] Failed to generate draft:', err);
  }
  
  return details.content || 'announcement';
}

/**
 * Save announcement draft to database
 */
export async function saveDraft(
  phoneNumber: string,
  draft: AnnouncementDraft,
  workspaceId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('announcement')
      .upsert({
        id: draft.id,
        creator_phone: phoneNumber,
        workspace_id: workspaceId,
        draft_content: draft.content,
        final_content: draft.content,
        tone: draft.tone || 'casual',
        scheduled_for: draft.scheduledFor?.toISOString(),
        status: draft.scheduledFor ? 'scheduled' : 'draft',
        target_audience: draft.targetAudience || 'all',
        updated_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Announcements] Error saving draft:', error);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error('[Announcements] Failed to save draft:', err);
    return null;
  }
}

/**
 * Get user's active draft
 */
export async function getActiveDraft(phoneNumber: string): Promise<AnnouncementDraft | null> {
  try {
    const { data, error } = await supabase
      .from('announcement')
      .select('*')
      .eq('creator_phone', phoneNumber)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      content: data.final_content || data.draft_content,
      tone: data.tone,
      scheduledFor: data.scheduled_for ? new Date(data.scheduled_for) : undefined,
      targetAudience: data.target_audience,
      workspaceId: data.workspace_id
    };
  } catch (err) {
    console.error('[Announcements] Failed to get draft:', err);
    return null;
  }
}

/**
 * Send announcement to all opted-in users
 */
export async function sendAnnouncement(
  announcementId: string,
  twilioClient: any
): Promise<number> {
  try {
    // Get announcement details
    const { data: announcement } = await supabase
      .from('announcement')
      .select('*')
      .eq('id', announcementId)
      .single();

    if (!announcement) {
      console.error('[Announcements] Announcement not found:', announcementId);
      return 0;
    }

    // Get all opted-in users
    const { data: recipients } = await supabase
      .from('sms_optin')
      .select('phone')
      .eq('opted_out', false);

    if (!recipients || recipients.length === 0) {
      console.log('[Announcements] No recipients found');
      return 0;
    }

    const message = announcement.final_content || announcement.draft_content;
    let sentCount = 0;

    // Send to each recipient
    for (const recipient of recipients) {
      try {
        const result = await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: `+1${recipient.phone}`
        });

        // Log delivery
        await supabase
          .from('announcement_delivery')
          .insert({
            announcement_id: announcementId,
            recipient_phone: recipient.phone,
            status: 'sent',
            twilio_sid: result.sid,
            sent_at: new Date().toISOString()
          });

        sentCount++;
      } catch (err) {
        console.error(`[Announcements] Failed to send to ${recipient.phone}:`, err);
        
        // Log failed delivery
        await supabase
          .from('announcement_delivery')
          .insert({
            announcement_id: announcementId,
            recipient_phone: recipient.phone,
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Unknown error',
            sent_at: new Date().toISOString()
          });
      }
    }

    // Mark announcement as sent
    await supabase.rpc('mark_announcement_sent', {
      p_announcement_id: announcementId,
      p_recipient_count: sentCount
    });

    return sentCount;
  } catch (err) {
    console.error('[Announcements] Failed to send announcement:', err);
    return 0;
  }
}

/**
 * Get previous announcements for reference
 */
export async function getPreviousAnnouncements(
  phoneNumber: string,
  limit: number = 5
): Promise<AnnouncementDraft[]> {
  try {
    const { data, error } = await supabase
      .from('announcement')
      .select('*')
      .eq('creator_phone', phoneNumber)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data.map(a => ({
      id: a.id,
      content: a.final_content || a.draft_content,
      tone: a.tone,
      scheduledFor: a.scheduled_for ? new Date(a.scheduled_for) : undefined,
      targetAudience: a.target_audience,
      workspaceId: a.workspace_id
    }));
  } catch (err) {
    console.error('[Announcements] Failed to get previous announcements:', err);
    return [];
  }
}

