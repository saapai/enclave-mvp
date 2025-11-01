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
  updatedAt?: string;
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
    lowerMsg.includes('i want to send an announcement') ||
    lowerMsg.includes('i want to make an announcement') ||
    lowerMsg.includes('announce') ||
    lowerMsg.includes('send announcement') ||
    lowerMsg.includes('broadcast')
  );
}

/**
 * Extract raw announcement text from message
 * Used when user just says "Ash is going to get touched" after being asked what to say
 */
export function extractRawAnnouncementText(message: string): string {
  // If message has quotes, extract from quotes (highest priority)
  const quoteMatch = message.match(/"([^"]+)"/);
  if (quoteMatch) {
    return quoteMatch[1];
  }
  
  // Check for "no it should say X" or "it should say X" - common correction pattern
  const shouldSayMatch = message.match(/(?:no,?\s+)?it\s+should\s+say\s+"?([^"]+)"?$/i);
  if (shouldSayMatch) {
    return shouldSayMatch[1].trim();
  }
  
  // Check for "no edit it to this exactly:", "edit it to this exactly:", etc - extract text after colon
  const exactEditMatch = message.match(/(?:no\s+)?edit\s+it\s+to\s+this\s+exactly\s*:?\s*(.+)/is);
  if (exactEditMatch) {
    return exactEditMatch[1].trim();
  }
  
  // Check for "no just", "actually", "change it to" etc - extract the actual text
  const correctionMatch = message.match(/(?:no,?\s+(?:just|it\s+should)|actually,?\s+)?(?:change\s+it\s+to|make\s+it|i\s+want\s+it\s+to\s+say|i\s+want\s+the\s+announcement\s+to\s+say|it\s+says?)\s+"?([^"]+)"?$/i);
  if (correctionMatch) {
    return correctionMatch[1].trim();
  }
  
  // Check for "i want the announcement to say..."
  const wantMatch = message.match(/i\s+want\s+(?:the\s+announcement\s+to\s+say|it\s+to\s+say)\s+"?([^"]+)"?$/i);
  if (wantMatch) {
    return wantMatch[1].trim();
  }
  
  // If message starts with "no" followed by content, assume everything after "no" is the correction
  const noStartMatch = message.match(/^no,?\s+(.+)$/i);
  if (noStartMatch && noStartMatch[1].length > 5) {
    // Only if there's substantial content after "no"
    return noStartMatch[1].trim();
  }
  
  // Otherwise return the message as-is
  return message;
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
    lowerMsg.includes('calmer and nicer') ||
    lowerMsg.includes('make it meaner') ||
    lowerMsg.includes('make it nicer') ||
    lowerMsg.includes('make it urgent') ||
    lowerMsg.includes('make it calmer')
  );
}

/**
 * Detect if message is requesting exact text usage (not tone modification)
 */
export function isExactTextRequest(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return (
    lowerMsg.includes('use my exact') ||
    lowerMsg.includes('exact wording') ||
    lowerMsg.includes('exact text') ||
    lowerMsg.includes('edit it to this exactly') ||
    (lowerMsg.startsWith('no') && lowerMsg.includes('exactly')) ||
    /(?:no,?\s+)?it\s+should\s+say/i.test(lowerMsg) || // "no it should say X"
    /^no,?\s+.*should\s+say/i.test(lowerMsg) // "no X should say Y"
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
    // First check if there's quoted text - use that exactly
    const quoteMatch = message.match(/"([^"]+)"/);
    if (quoteMatch) {
      return {
        content: quoteMatch[1],
        scheduledFor: null,
        tone: 'casual',
        targetAudience: 'all'
      };
    }
    
    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`;
    const aiRes = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Extract announcement details from this message: "${message}"
        
Return JSON with these fields:
- content: ONLY the core event/info being announced (NOT "tell people to come to", just the event itself)
- scheduledFor: when to send it (ISO date/time or null for immediate)
- tone: the tone (neutral/urgent/casual/mean or null)
- targetAudience: who to send to (all/actives/pledges or null)

Examples:
"create an announcement telling actives to come to meeting tonight at 8" → {"content":"meeting tonight at 8","scheduledFor":null,"tone":"neutral","targetAudience":"actives"}
"make an announcement about study hall tomorrow" → {"content":"study hall tomorrow","scheduledFor":null,"tone":"casual","targetAudience":"all"}
"send an announcement to remind people about active meeting" → {"content":"active meeting","scheduledFor":null,"tone":"neutral","targetAudience":"all"}

IMPORTANT: Extract ONLY the core event/info, NOT command words like "tell people", "remind", "come to", etc.

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
    const content = details.content || '';
    
    // CRITICAL: If content has quotes or is short, use it EXACTLY (don't paraphrase)
    const hasQuotes = content.includes('"');
    const isShort = content.length < 200 && content.length > 5;
    
    if ((hasQuotes || isShort) && !previousDraft) {
      // Use exact text - user is providing the exact message they want
      let draft = content.replace(/^["']|["']$/g, ''); // Remove outer quotes only
      
      // Ensure first char is lowercase unless it's an acronym
      if (draft.length > 0 && draft[0] === draft[0].toUpperCase() && draft[0] !== draft[0].toLowerCase()) {
        if (!draft.match(/^[A-Z]{2,}/)) { // Not an all-caps acronym
          draft = draft[0].toLowerCase() + draft.substring(1);
        }
      }
      
      return draft;
    }
    
    // Otherwise, generate with AI based on tone
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
      : `Write an announcement for: "${content}"

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
      let draft = aiData.response || content || 'announcement';
      
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
      workspaceId: data.workspace_id,
      updatedAt: data.updated_at
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
        // Ensure phone is in E.164 format (already has +1 or just needs it)
        const phoneNumber = recipient.phone.startsWith('+') ? recipient.phone : `+1${recipient.phone}`;
        
        const result = await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phoneNumber
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

