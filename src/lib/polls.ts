/**
 * Poll Handler
 * Manages poll drafting, editing, and sending via SMS with conversational responses
 */

import { supabaseAdmin } from './supabase';
import Airtable from 'airtable';
import { ENV } from './env';

export interface PollDraft {
  id?: string;
  question: string;
  options: string[];
  tone?: string;
  workspaceId?: string;
  airtableQuestionField?: string; // Track the dynamic Airtable field name for this poll
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Detect if message is a poll request
 */
export function isPollRequest(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return (
    lowerMsg.includes('create a poll') ||
    lowerMsg.includes('send a poll') ||
    lowerMsg.includes('make a poll') ||
    lowerMsg.includes('i want to send a poll') ||
    lowerMsg.includes('i want to make a poll') ||
    lowerMsg.includes('poll text blast') ||
    lowerMsg.includes('send poll')
  );
}

/**
 * Extract poll details from message using LLM
 */
export async function extractPollDetails(message: string): Promise<{
  question?: string;
  options?: string[];
  tone?: string;
}> {
  try {
    // First check if there's quoted text - use that exactly
    const quoteMatch = message.match(/"([^"]+)"/);
    if (quoteMatch) {
      return {
        question: quoteMatch[1],
        options: ['Yes', 'No', 'Maybe'],
        tone: 'casual'
      };
    }
    
    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`;
    const aiRes = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Extract poll details from this message: "${message}"
        
Return JSON with these fields:
- question: ONLY the core event/topic being asked about (NOT "are you coming to", just the event itself)
- options: array of response options (if not specified, default to ["Yes", "No", "Maybe"])
- tone: the tone (neutral/urgent/casual or null)

Examples:
"create a poll asking if people are coming to active meeting tonight" → {"question":"active meeting tonight","options":["Yes","No","Maybe"],"tone":"casual"}
"make a poll about study hall tomorrow at 9am" → {"question":"study hall tomorrow at 9am","options":["Yes","No","Maybe"],"tone":"casual"}
"i want to send a poll to see if people are coming to active meeting" → {"question":"active meeting","options":["Yes","No","Maybe"],"tone":"casual"}

IMPORTANT: Extract ONLY the event/topic name, NOT the full question like "are you coming to X". Just return "X".

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
        const parsed = JSON.parse(jsonMatch[0]);
        // Ensure options default to Yes/No/Maybe
        if (!parsed.options || parsed.options.length === 0) {
          parsed.options = ['Yes', 'No', 'Maybe'];
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error('[Polls] Failed to extract details:', err);
  }
  
  return { options: ['Yes', 'No', 'Maybe'] };
}

/**
 * Generate conversational poll question based on details
 */
export async function generatePollQuestion(
  details: { question?: string; tone?: string },
  previousDraft?: string
): Promise<string> {
  try {
    const question = details.question || '';
    
    // If it's short and specific, use it directly
    const isShort = question.length < 200 && question.length > 5;
    
    if (isShort && !previousDraft) {
      // Convert to conversational format
      let draft = question.replace(/^["']|["']$/g, ''); // Remove outer quotes
      
      // If it's already a complete question, just ensure it's conversational
      if (draft.match(/\?$/)) {
        // Already a question - just ensure it starts casually
        if (!draft.match(/^(yo|hey|sup|u |are you|you |who)/i)) {
          draft = `yo ${draft}`;
        }
        return draft;
      }
      
      // Remove verbose phrases that AI might have added
      draft = draft.replace(/^(are you coming to|if people are coming to|if you are coming to|coming to|going to|people are coming to)\s*/i, '');
      
      // Make it conversational
      if (!draft.match(/^(yo|hey|sup)/i)) {
        draft = `yo are you coming to ${draft}`;
      }
      
      return draft;
    }
    
    // Otherwise, generate with AI based on tone
    const toneInstructions: Record<string, string> = {
      urgent: "make it urgent like 'need to know ASAP'",
      casual: "make it casual and friendly, like texting a friend",
      neutral: "keep it straightforward and conversational"
    };

    const tone = details.tone || 'casual';
    const toneInstruction = toneInstructions[tone] || toneInstructions.casual;

    const prompt = previousDraft
      ? `Modify this poll question to ${toneInstruction}:

Original: "${previousDraft}"

New question (keep it conversational, under 160 chars, like texting a friend):`
      : `Write a conversational poll question for: "${question}"

Style: ${toneInstruction}
Keep it under 160 chars, conversational like texting a friend. Start with "yo" or similar.
Make it a question asking if they're coming/attending.

Question:`;

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
      let draft = aiData.response || question || 'yo are you coming';
      
      // Remove quotes if present
      draft = draft.replace(/^["']|["']$/g, '');
      
      return draft;
    }
  } catch (err) {
    console.error('[Polls] Failed to generate question:', err);
  }
  
  return details.question || 'yo are you coming';
}

/**
 * Save poll draft to database
 */
export async function savePollDraft(
  phoneNumber: string,
  draft: PollDraft,
  workspaceId: string
): Promise<string | null> {
  try {
    const code = Math.random().toString(36).slice(2, 6).toUpperCase();
    
    const { data, error } = await supabaseAdmin
      .from('sms_poll')
      .upsert({
        id: draft.id,
        space_id: workspaceId,
        question: draft.question,
        options: draft.options,
        code: code,
        created_by: phoneNumber,
        status: 'draft',
        updated_at: new Date().toISOString()
      } as any)
      .select('id')
      .single();

    if (error) {
      console.error('[Polls] Error saving draft:', error);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error('[Polls] Failed to save draft:', err);
    return null;
  }
}

/**
 * Get user's active poll draft
 */
export async function getActivePollDraft(phoneNumber: string): Promise<PollDraft | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('sms_poll')
      .select('*')
      .eq('created_by', phoneNumber)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      question: data.question,
      options: data.options,
      workspaceId: data.space_id,
      airtableQuestionField: data.airtable_question_field,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (err) {
    console.error('[Polls] Failed to get draft:', err);
    return null;
  }
}

/**
 * Create dynamic Airtable fields for a new poll
 */
export async function createAirtableFieldsForPoll(
  pollQuestion: string
): Promise<{ questionField: string; responseField: string; notesField: string }> {
  if (!ENV.AIRTABLE_API_KEY || !ENV.AIRTABLE_BASE_ID || !ENV.AIRTABLE_TABLE_NAME) {
    console.warn('[Polls] Airtable not configured, skipping field creation');
    return { questionField: 'Question', responseField: 'Response', notesField: 'Notes' };
  }

  try {
    const base = new Airtable({ apiKey: ENV.AIRTABLE_API_KEY }).base(ENV.AIRTABLE_BASE_ID);
    
    // Shorten question for field name (max 50 chars)
    const shortQuestion = pollQuestion.length > 40 
      ? pollQuestion.substring(0, 40).trim() + '...' 
      : pollQuestion;
    
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const questionFieldName = `${shortQuestion} (${timestamp})`;
    const responseFieldName = `${shortQuestion} Response`;
    const notesFieldName = `${shortQuestion} Notes`;

    // Create fields via Airtable Metadata API
    // Note: This requires Airtable Enterprise or using the web API
    // For now, we'll store the field names and let Airtable auto-create them on first insert
    
    console.log(`[Polls] Will use Airtable fields: ${questionFieldName}, ${responseFieldName}, ${notesFieldName}`);
    
    return {
      questionField: questionFieldName,
      responseField: responseFieldName,
      notesField: notesFieldName
    };
  } catch (err) {
    console.error('[Polls] Failed to create Airtable fields:', err);
    // Fallback to generic names
    return { questionField: 'Question', responseField: 'Response', notesField: 'Notes' };
  }
}

/**
 * Send poll to all recipients in workspace
 */
export async function sendPoll(
  pollId: string,
  twilioClient: any
): Promise<{ sentCount: number; airtableLink?: string }> {
  try {
    // Get poll details
    const { data: poll } = await supabaseAdmin
      .from('sms_poll')
      .select('*')
      .eq('id', pollId)
      .single();

    if (!poll) {
      console.error('[Polls] Poll not found:', pollId);
      return { sentCount: 0 };
    }

    // Get all opted-in users (same as announcements)
    const { data: optedInUsers } = await supabaseAdmin
      .from('sms_optin')
      .select('phone')
      .eq('opted_out', false);

    if (!optedInUsers || optedInUsers.length === 0) {
      console.log('[Polls] No opted-in recipients found');
      return { sentCount: 0 };
    }

    // Deduplicate and normalize phone numbers
    const uniquePhones = new Set(
      optedInUsers
        .map(u => u.phone)
        .filter(Boolean)
        .map(p => {
          // Normalize to E.164 format
          const phone = String(p);
          return phone.startsWith('+') ? phone : `+1${phone}`;
        })
    );
    const recipients = Array.from(uniquePhones);
    
    console.log(`[Polls] Sending to ${recipients.length} unique recipients`);

    // Create Airtable fields for this poll
    const airtableFields = await createAirtableFieldsForPoll(poll.question);
    
    // Update poll with Airtable field names
    await supabaseAdmin
      .from('sms_poll')
      .update({
        airtable_question_field: airtableFields.questionField,
        airtable_response_field: airtableFields.responseField,
        airtable_notes_field: airtableFields.notesField
      } as any)
      .eq('id', pollId);

    const conversationalMessage = poll.question; // Already conversational from generatePollQuestion
    let sentCount = 0;

    // Send to each recipient
    for (const phoneE164 of recipients) {
      try {
        const result = await twilioClient.messages.create({
          body: conversationalMessage,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phoneE164
        });

        console.log(`[Polls] Sent to ${phoneE164}, Twilio SID: ${result.sid}`);

        // Seed poll response (will collect name later)
        await supabaseAdmin
          .from('sms_poll_response')
          .upsert({
            poll_id: pollId,
            phone: phoneE164,
            option_index: -1,
            option_label: '',
            response_status: 'pending'
          } as any, {
            onConflict: 'poll_id,phone'
          } as any);

        sentCount++;
      } catch (err) {
        console.error(`[Polls] Failed to send to ${phoneE164}:`, err);
      }
    }

    // Mark poll as sent
    await supabaseAdmin
      .from('sms_poll')
      .update({ status: 'sent', sent_at: new Date().toISOString() } as any)
      .eq('id', pollId);

    const rawResultsUrl = ENV.AIRTABLE_PUBLIC_RESULTS_URL;
    const airtableLink = rawResultsUrl?.replace(/^@+/, '') || undefined;

    return { sentCount, airtableLink };
  } catch (err) {
    console.error('[Polls] Failed to send poll:', err);
    return { sentCount: 0 };
  }
}

/**
 * Parse response and extract yes/no/maybe + notes
 */
export async function parseResponseWithNotes(
  message: string,
  options: string[]
): Promise<{ option: string; notes?: string }> {
  try {
    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`;
    const aiRes = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Parse this poll response: "${message}"

Valid options: ${options.join(', ')}

Extract:
- option: which option they chose (must be one of: ${options.join(', ')})
- notes: any additional context (e.g. "running 15 late", "might be late", etc)

Examples:
"ya but im running 15 late" → {"option":"Yes","notes":"running 15 late"}
"yes" → {"option":"Yes"}
"nah can't make it" → {"option":"No","notes":"can't make it"}

Only return valid JSON, nothing else.`,
        context: '',
        type: 'general'
      })
    });

    if (aiRes.ok) {
      const aiData = await aiRes.json();
      const response = aiData.response || '{}';
      
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate option is in valid options (case-insensitive)
        const validOption = options.find(
          opt => opt.toLowerCase() === parsed.option?.toLowerCase()
        );
        
        if (validOption) {
          return {
            option: validOption,
            notes: parsed.notes || undefined
          };
        }
      }
    }
  } catch (err) {
    console.error('[Polls] Failed to parse response:', err);
  }
  
  // Fallback: simple keyword matching
  const lowerMsg = message.toLowerCase();
  for (const opt of options) {
    if (lowerMsg.includes(opt.toLowerCase())) {
      // Extract notes (anything after the option)
      const optIndex = lowerMsg.indexOf(opt.toLowerCase());
      const afterOption = message.substring(optIndex + opt.length).trim();
      const notes = afterOption.replace(/^(but|and|,)\s*/i, '').trim();
      
      return {
        option: opt,
        notes: notes || undefined
      };
    }
  }
  
  return { option: '', notes: message };
}

/**
 * Get or ask for person's name
 */
export async function getOrAskForName(phone: string): Promise<string | null> {
  try {
    // Check if we have a name in sms_poll_response
    const { data: existing } = await supabaseAdmin
      .from('sms_poll_response')
      .select('person_name')
      .eq('phone', phone)
      .not('person_name', 'is', null)
      .limit(1)
      .maybeSingle();

    if (existing?.person_name) {
      return existing.person_name;
    }

    // Check app_user
    const { data: appUser } = await supabaseAdmin
      .from('app_user')
      .select('name')
      .ilike('phone', `%${phone.slice(-10)}%`)
      .limit(1)
      .maybeSingle();

    return appUser?.name || null;
  } catch (err) {
    console.error('[Polls] Failed to get name:', err);
    return null;
  }
}

/**
 * Save name for a phone number
 */
export async function saveName(phone: string, name: string): Promise<void> {
  try {
    // Update all existing responses for this phone
    await supabaseAdmin
      .from('sms_poll_response')
      .update({ person_name: name } as any)
      .eq('phone', phone);

    console.log(`[Polls] Saved name "${name}" for phone ${phone}`);
  } catch (err) {
    console.error('[Polls] Failed to save name:', err);
  }
}

/**
 * Record poll response in Supabase and Airtable
 */
export async function recordPollResponse(
  pollId: string,
  phone: string,
  option: string,
  notes?: string,
  personName?: string
): Promise<boolean> {
  try {
    // Get poll details
    const { data: poll } = await supabaseAdmin
      .from('sms_poll')
      .select('*')
      .eq('id', pollId)
      .single();

    if (!poll) {
      console.error('[Polls] Poll not found:', pollId);
      return false;
    }

    const optionIndex = (poll.options as string[]).indexOf(option);
    if (optionIndex === -1) {
      console.error('[Polls] Invalid option:', option);
      return false;
    }

    // Update Supabase
    await supabaseAdmin
      .from('sms_poll_response')
      .upsert({
        poll_id: pollId,
        phone: phone,
        option_index: optionIndex,
        option_label: option,
        notes: notes || null,
        person_name: personName || null,
        response_status: 'answered',
        received_at: new Date().toISOString()
      } as any, {
        onConflict: 'poll_id,phone'
      });

    // Update or create Airtable record
    if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
      const base = new Airtable({ apiKey: ENV.AIRTABLE_API_KEY }).base(ENV.AIRTABLE_BASE_ID);
      
      const questionField = poll.airtable_question_field || 'Question';
      const responseField = poll.airtable_response_field || 'Response';
      const notesField = poll.airtable_notes_field || 'Notes';

      // Check if record exists for this person
      const records = await base(ENV.AIRTABLE_TABLE_NAME)
        .select({
          filterByFormula: `{Person} = "${personName || phone}"`
        })
        .firstPage();

      const fields: Record<string, any> = {
        Person: personName || phone,
        Phone: phone,
        [responseField]: option
      };

      if (notes) {
        fields[notesField] = notes;
      }

      if (records.length > 0) {
        // Update existing record
        await base(ENV.AIRTABLE_TABLE_NAME).update([
          {
            id: records[0].id,
            fields
          }
        ]);
        console.log(`[Polls] Updated Airtable record for ${personName || phone}`);
      } else {
        // Create new record
        await base(ENV.AIRTABLE_TABLE_NAME).create([{ fields }]);
        console.log(`[Polls] Created Airtable record for ${personName || phone}`);
      }
    }

    return true;
  } catch (err) {
    console.error('[Polls] Failed to record response:', err);
    return false;
  }
}

