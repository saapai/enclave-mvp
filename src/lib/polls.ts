/**
 * Poll Handler
 * Manages poll drafting, editing, and sending via SMS with conversational responses
 */

import { supabaseAdmin } from './supabase';
import { normalizeE164 } from './sms';
import Airtable from 'airtable';
import { ENV } from './env';
import { createAirtableFields, normalizePhoneForAirtable, upsertAirtableRecord } from './airtable';
import { parsePollQuotes, hasQuotes } from './nlp/quotes';

const POLL_MATCH_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'about', 'from', 'your',
  'just', 'what', 'when', 'where', 'who', 'how', 'cant', "can't", 'cannot',
  'make', 'into', 'into', 'today', 'tonight', 'gonna', 'goin', 'going', 'like',
  'into', 'since', 'because', 'please', 'reply', 'send', 'broadcast', 'thanks',
  'thank', 'hey', 'hello', 'hi', 'yo', 'ill', "i'll", 'im', "i'm", 'to', 'at',
  'in', 'on', 'it', 'is', 'be', 'are', 'was', 'were', 'as', 'an', 'a'
]);

function extractMeaningfulPollTokens(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !POLL_MATCH_STOPWORDS.has(token));

  return Array.from(new Set(cleaned));
}

function scorePollMatch(questionLower: string, tokens: string[], textLower: string): number {
  let score = 0;
  for (const token of tokens) {
    if (questionLower.includes(token)) {
      score += 1;
    }
  }

  const hasMeeting = /\bmeeting\b/.test(textLower) || /\bgm\b/.test(textLower) || /general\s+meeting/.test(textLower);
  const hasBigLittle = /big\s*little/.test(textLower);
  const hasSummons = /summons/.test(textLower);
  const hasChapter = /chapter/.test(textLower);

  if (hasMeeting && questionLower.includes('meeting')) score += 2;
  if (hasBigLittle && questionLower.includes('big little')) score += 3;
  if (hasSummons && questionLower.includes('summons')) score += 2;
  if (hasChapter && questionLower.includes('chapter')) score += 1;

  return score;
}

function normalizePollQuestionText(raw: string, verbatim = false): string {
  let text = (raw || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

  if (!text) {
    return 'yo are you coming?';
  }

  // Remove surrounding quotes if present
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }

  if (verbatim) {
    return text;
  }

  const ensureQuestionMark = (value: string): string => {
    const trimmed = value.trim();
    return trimmed.endsWith('?') ? trimmed : `${trimmed}?`;
  };

  const addYoPrefix = (value: string): string => {
    const trimmed = value.trim();
    if (/^yo\b/i.test(trimmed)) {
      return trimmed.replace(/^yo\s+/i, 'yo ').trim();
    }
    return `yo ${trimmed}`.replace(/^yo\s+yo\s+/i, 'yo ').trim();
  };

  const normalized = text.toLowerCase();
  const questionStarterRegex = /^(yo|are|do|does|did|will|would|can|could|should|is|was|were|if|who|what|when|where|why|how|can you|can u|can ya|can y'all|can yall|can we|should we|would you|will you|could you)\b/;

  if (questionStarterRegex.test(normalized) || text.includes('?')) {
    let final = text.replace(/\s+\?/g, '?').trim();
    final = ensureQuestionMark(final);
    final = addYoPrefix(final);
    return final;
  }

  if (/^(if|whether)\s+/i.test(normalized)) {
    const rest = text.replace(/^(if|whether)\s+/i, '').trim();
    let final = `yo can you ${rest}`;
    final = ensureQuestionMark(final);
    return final.replace(/\s+\?/g, '?');
  }

  if (/^(come|coming|can you come|can ya come|can u come|pull up|pulling up|show up|showing up|attend|attending|are you coming|are you able to)/i.test(normalized)) {
    let final = addYoPrefix(text);
    final = ensureQuestionMark(final);
    return final.replace(/\s+\?/g, '?');
  }

  let final = `yo are you coming to ${text}`;
  final = ensureQuestionMark(final);
  return final.replace(/\s+\?/g, '?');
}

type PollRecord = {
  id: string
  question: string
  options: string[]
  status: string
  requires_reason?: boolean | null
  airtable_question_field?: string | null
  airtable_response_field?: string | null
  airtable_notes_field?: string | null
}

export type PendingPollContext = {
  poll: PollRecord
  response: {
    poll_id: string
    phone: string
    response_status?: string | null
    option_index?: number | null
    option_label?: string | null
    notes?: string | null
    person_name?: string | null
  }
}

function normalizePhoneCandidates(lastTen: string, fullPhone?: string): string[] {
  const candidates = new Set<string>()
  const cleanDigits = lastTen.replace(/[^\d]/g, '')
  if (cleanDigits.length >= 10) {
    const last10 = cleanDigits.slice(-10)
    candidates.add(last10)
    candidates.add(`+1${last10}`)
  } else if (cleanDigits.length > 0) {
    candidates.add(cleanDigits)
  }

  if (fullPhone) {
    candidates.add(fullPhone)
    const fullDigits = fullPhone.replace(/[^\d]/g, '')
    if (fullDigits.length >= 10) {
      const last10 = fullDigits.slice(-10)
      candidates.add(last10)
      if (!fullPhone.startsWith('+')) {
        candidates.add(`+1${last10}`)
      }
    }
  }

  return Array.from(candidates).filter(Boolean)
}

export async function getPendingPollForPhone(
  phoneNumber: string,
  fullPhoneNumber?: string
): Promise<PendingPollContext | null> {
  if (!supabaseAdmin) {
    console.error('[Polls] Supabase admin client not available for getPendingPollForPhone')
    return null
  }

  const candidates = normalizePhoneCandidates(phoneNumber, fullPhoneNumber)
  if (candidates.length === 0) {
    return null
  }

  const selectClause = `
    poll_id,
    phone,
    response_status,
    option_index,
    option_label,
    notes,
    person_name,
    poll:sms_poll (
      id,
      question,
      options,
      status,
      requires_reason,
      airtable_question_field,
      airtable_response_field,
      airtable_notes_field
    )
  `

  const fetchLatest = async (pendingOnly: boolean) => {
    let query = supabaseAdmin
      .from('sms_poll_response')
      .select(selectClause)
      .in('phone', candidates)
      .order('received_at', { ascending: false, nullsFirst: true })
      .limit(1)
      .maybeSingle()

    if (pendingOnly) {
      query = query.eq('response_status', 'pending')
    }

    const { data, error } = await query
    if (error) {
      console.error('[Polls] Failed to fetch pending poll for phone:', error)
      return null
    }

    if (!data || !data.poll || data.poll.status !== 'sent') {
      return null
    }

    return {
      poll: {
        id: data.poll.id,
        question: data.poll.question,
        options: (data.poll.options as string[]) || ['Yes', 'No', 'Maybe'],
        status: data.poll.status,
        requires_reason: data.poll.requires_reason,
        airtable_question_field: data.poll.airtable_question_field,
        airtable_response_field: data.poll.airtable_response_field,
        airtable_notes_field: data.poll.airtable_notes_field
      },
      response: {
        poll_id: data.poll_id,
        phone: data.phone,
        response_status: data.response_status,
        option_index: data.option_index,
        option_label: data.option_label,
        notes: data.notes,
        person_name: data.person_name
      }
    } satisfies PendingPollContext
  }

  return (await fetchLatest(true)) || (await fetchLatest(false))
}

export async function getPollContextForMessage(
  phoneNumber: string,
  fullPhoneNumber: string | undefined,
  messageText: string
): Promise<PendingPollContext | null> {
  const directContext = await getPendingPollForPhone(phoneNumber, fullPhoneNumber)
  if (directContext) {
    return directContext
  }

  if (!supabaseAdmin) {
    console.error('[Polls] Supabase admin client not available for getPollContextForMessage')
    return null
  }

  const trimmed = (messageText || '').trim()
  if (!trimmed) {
    return null
  }

  const textLower = trimmed.toLowerCase()
  const tokens = extractMeaningfulPollTokens(textLower)

  try {
    const { data: polls, error } = await supabaseAdmin
      .from('sms_poll')
      .select('id, question, options, status, requires_reason, airtable_question_field, airtable_response_field, airtable_notes_field, sent_at, created_at')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false, nullsLast: true })
      .order('created_at', { ascending: false })
      .limit(8)

    if (error) {
      console.error('[Polls] Failed to fetch recent polls for fallback:', error)
      return null
    }

    if (!polls || polls.length === 0) {
      return null
    }

    let bestPoll: any = null
    let bestScore = -Infinity

    for (const poll of polls) {
      const questionLower = (poll.question || '').toLowerCase()
      const score = scorePollMatch(questionLower, tokens, textLower)

      if (score > bestScore) {
        bestScore = score
        bestPoll = poll
      }
    }

    if (!bestPoll) {
      return null
    }

    const hasStrongMatch = bestScore > 0 || polls.length === 1
    if (!hasStrongMatch) {
      console.log('[Polls] Fallback poll match skipped due to low score', { bestScore, message: textLower })
      return null
    }

    const responsePhone = normalizeE164(fullPhoneNumber || phoneNumber)

    await supabaseAdmin
      .from('sms_poll_response')
      .upsert({
        poll_id: bestPoll.id,
        phone: responsePhone,
        option_index: -1,
        option_label: '',
        response_status: 'pending'
      } as any, {
        onConflict: 'poll_id,phone'
      } as any)

    return {
      poll: {
        id: bestPoll.id,
        question: bestPoll.question,
        options: (bestPoll.options as string[]) || ['Yes', 'No', 'Maybe'],
        status: bestPoll.status,
        requires_reason: bestPoll.requires_reason,
        airtable_question_field: bestPoll.airtable_question_field,
        airtable_response_field: bestPoll.airtable_response_field,
        airtable_notes_field: bestPoll.airtable_notes_field
      },
      response: {
        poll_id: bestPoll.id,
        phone: responsePhone,
        response_status: 'pending'
      }
    }
  } catch (err) {
    console.error('[Polls] Failed to resolve poll context for message:', err)
    return null
  }
}

export interface PollDraft {
  id?: string;
  question: string;
  options: string[];
  tone?: string;
  workspaceId?: string;
  airtableQuestionField?: string; // Track the dynamic Airtable field name for this poll
  requiresReason?: boolean; // If true, "No" responses must include a reason
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
    if (hasQuotes(message)) {
      const { question, options } = parsePollQuotes(message);
      return {
        question: question || undefined,
        options: options || ['Yes', 'No', 'Maybe'],
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
  details: { question?: string; tone?: string; verbatim?: boolean },
  previousDraft?: string
): Promise<string> {
  try {
    const candidate = (details.question || '').trim()
    if (candidate.length > 0) {
      return normalizePollQuestionText(candidate, details.verbatim === true)
    }

    if (previousDraft && previousDraft.trim().length > 0) {
      return normalizePollQuestionText(previousDraft)
    }

    const toneInstructions: Record<string, string> = {
      urgent: "make it urgent like 'need to know ASAP'",
      casual: "make it casual and friendly, like texting a friend",
      neutral: 'keep it straightforward and conversational'
    }

    const tone = details.tone || 'casual'
    const toneInstruction = toneInstructions[tone] || toneInstructions.casual

    const prompt = `Write a conversational poll question.
Style: ${toneInstruction}
Keep it under 160 chars, conversational like texting a friend. Start with "yo" or similar.
Ask if they are attending.`

    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
    const aiRes = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: prompt,
        context: '',
        type: 'general'
      })
    })

    if (aiRes.ok) {
      const aiData = await aiRes.json()
      const draft = (aiData.response || '').replace(/^['"`]|['"`]$/g, '').trim()
      if (draft.length > 0) {
        return normalizePollQuestionText(draft)
      }
    }
  } catch (err) {
    console.error('[Polls] Failed to generate question:', err)
  }

  return 'yo are you coming?'
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
        requires_reason: draft.requiresReason || false,
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
 * Sanitize question text for use in Airtable field names
 */
function sanitizeFieldName(text: string, maxLength: number = 25): string {
  // Lowercase, replace spaces with underscores, remove special chars
  let sanitized = text
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, maxLength)
    .replace(/_+$/, ''); // Remove trailing underscores
  
  return sanitized || 'poll'
}

/**
 * Create dynamic Airtable fields for a new poll
 */
export async function createAirtableFieldsForPoll(
  pollQuestion: string
): Promise<{ questionField: string; responseField: string; notesField: string; fieldsCreated: boolean }> {
  if (!ENV.AIRTABLE_API_KEY || !ENV.AIRTABLE_BASE_ID || !ENV.AIRTABLE_TABLE_NAME) {
    console.warn('[Polls] Airtable not configured, skipping field creation');
    return { questionField: 'Question', responseField: 'Response', notesField: 'Notes', fieldsCreated: false };
  }

  try {
    // Sanitize question for field name
    const sanitized = sanitizeFieldName(pollQuestion, 25)
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '_'); // YYYY_MM_DD
    
    const questionFieldName = `${sanitized}_Question_${timestamp}`
    const responseFieldName = `${sanitized}_Response_${timestamp}`
    const notesFieldName = `${sanitized}_Notes_${timestamp}`

    // Try to create fields via Metadata API if table ID is provided
    if (ENV.AIRTABLE_TABLE_ID && ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID) {
      console.log(`[Polls] Attempting to create Airtable fields via Metadata API...`)
      console.log(`[Polls] Configuration:`)
      console.log(`[Polls]   Base ID: ${ENV.AIRTABLE_BASE_ID}`)
      console.log(`[Polls]   Table ID: ${ENV.AIRTABLE_TABLE_ID}`)
      console.log(`[Polls]   Table Name: ${ENV.AIRTABLE_TABLE_NAME || 'not set'}`)
      
      const result = await createAirtableFields(
        ENV.AIRTABLE_BASE_ID,
        ENV.AIRTABLE_TABLE_ID,
        {
          question: questionFieldName,
          response: responseFieldName,
          notes: notesFieldName
        },
        ENV.AIRTABLE_API_KEY
      )
      
      const allFieldsExist = (result.created.length + result.existing.length) === 3
      
      if (result.ok && allFieldsExist) {
        console.log(`[Polls] ✓ All 3 Airtable fields exist:`)
        if (result.created.length > 0) {
          console.log(`[Polls]   Created: ${result.created.join(', ')}`)
        }
        if (result.existing.length > 0) {
          console.log(`[Polls]   Already existed: ${result.existing.join(', ')}`)
        }
        if (result.errors.length > 0) {
          console.warn(`[Polls] ⚠️ Some fields had warnings (but all exist):`, result.errors)
        }
      } else {
        console.error(`[Polls] ❌ Field creation incomplete:`)
        console.error(`[Polls]   Created: ${result.created.length} fields`)
        console.error(`[Polls]   Existing: ${result.existing.length} fields`)
        console.error(`[Polls]   Errors: ${result.errors.length} errors`)
        console.error(`[Polls]   Total: ${result.created.length + result.existing.length}/3 fields exist`)
        
        if (result.errors.length > 0) {
          console.error(`[Polls]   Error details:`, result.errors)
        }
        
        const missingFields: string[] = []
        if (!result.created.includes(questionFieldName) && !result.existing.includes(questionFieldName)) {
          missingFields.push(questionFieldName)
        }
        if (!result.created.includes(responseFieldName) && !result.existing.includes(responseFieldName)) {
          missingFields.push(responseFieldName)
        }
        if (!result.created.includes(notesFieldName) && !result.existing.includes(notesFieldName)) {
          missingFields.push(notesFieldName)
        }
        
        if (missingFields.length > 0) {
          console.error(`[Polls] ❌ Missing fields: ${missingFields.join(', ')}`)
          console.error(`[Polls] ACTION REQUIRED:`)
          console.error(`[Polls]   1. Check AIRTABLE_TABLE_ID is set correctly in Vercel`)
          console.error(`[Polls]   2. Verify PAT has schema.bases:write scope`)
          console.error(`[Polls]   3. Check table ID matches: Get from URL: https://airtable.com/app.../tblXXXXXXXXXXXXXX/...`)
          console.error(`[Polls]   4. Or manually create missing fields in Airtable:`)
          missingFields.forEach(field => {
            let fieldType = 'Single line text'
            if (field.includes('Response')) fieldType = 'Single select (Yes, No, Maybe)'
            if (field.includes('Notes')) fieldType = 'Long text'
            console.error(`[Polls]      - ${field} (${fieldType})`)
          })
        }
      }
      
      return {
        questionField: questionFieldName,
        responseField: responseFieldName,
        notesField: notesFieldName,
        fieldsCreated: result.ok && (result.created.length + result.existing.length) === 3
      };
    } else {
      console.warn(`[Polls] ⚠️ AIRTABLE_TABLE_ID not set - cannot create fields automatically`)
      console.warn(`[Polls] Get Table ID from Airtable URL: https://airtable.com/appecxe8XTHF7yA5a/tblXXXXXXXXXXXXXX/...`)
      console.warn(`[Polls] Set AIRTABLE_TABLE_ID in Vercel environment variables`)
      console.warn(`[Polls] Until then, manually create fields:`)
      console.warn(`[Polls]   - ${questionFieldName} (Single line text)`)
      console.warn(`[Polls]   - ${responseFieldName} (Single select: Yes, No, Maybe)`)
      console.warn(`[Polls]   - ${notesFieldName} (Long text)`)
      
      return {
        questionField: questionFieldName,
        responseField: responseFieldName,
        notesField: notesFieldName,
        fieldsCreated: false
      };
    }
  } catch (err) {
    console.error('[Polls] Failed to create Airtable fields:', err);
    // Return field names but mark as not created
    return { 
      questionField: questionFieldName || 'Question', 
      responseField: responseFieldName || 'Response', 
      notesField: notesFieldName || 'Notes',
      fieldsCreated: false
    };
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

    // Create Airtable fields for this poll BEFORE sending
    // This ensures fields exist when users respond
    console.log(`[Polls] Creating Airtable fields for poll: "${poll.question.substring(0, 50)}..."`)
    const airtableFields = await createAirtableFieldsForPoll(poll.question);
    
    // Verify fields were created - if not, poll responses will fail
    if (!airtableFields.fieldsCreated) {
      console.error(`[Polls] ❌ CRITICAL: Fields were NOT created in Airtable. Poll responses will FAIL.`)
      console.error(`[Polls] Poll will be sent but responses cannot be saved to Airtable until fields are created.`)
      console.error(`[Polls] Check logs above for field creation errors and required actions.`)
      // Continue anyway - Supabase will still work
    } else {
      console.log(`[Polls] ✓ All 3 fields confirmed to exist in Airtable`)
    }
    
    // Update poll with Airtable field names (even if creation failed, store names for manual creation)
    await supabaseAdmin
      .from('sms_poll')
      .update({
        airtable_question_field: airtableFields.questionField,
        airtable_response_field: airtableFields.responseField,
        airtable_notes_field: airtableFields.notesField
      } as any)
      .eq('id', pollId);
    
    console.log(`[Polls] Airtable fields configured: ${airtableFields.questionField}, ${airtableFields.responseField}, ${airtableFields.notesField}`);

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
  
  // Fallback: simple keyword matching (handle emojis and edge cases)
  const lowerMsg = message.toLowerCase();
  
  // Remove emojis for matching (but keep original for notes)
  const cleanMsg = message.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim()
  const lowerCleanMsg = cleanMsg.toLowerCase()
  
  const noOptionKeyword = /^(no|nope|nah|naw|n)\b/i
  if (noOptionKeyword.test(lowerCleanMsg)) {
    const noOption = options.find(opt => opt.toLowerCase() === 'no')
    if (noOption) {
      const remaining = cleanMsg.replace(noOptionKeyword, '').trim()
      const notes = remaining.replace(/^(but|and|,)/i, '').trim()
      return { option: noOption, notes: notes || undefined }
    }
  }

  // Check for excused requests or can't make it statements
  const noLikePatterns = [
    /(can't|cant|cannot)\s+(come|make it|attend|go)/i,
    /\bexcused\b/i,
    /\bexcuse me\b/i,
    /\bam i excused\b/i,
    /\bcan i be excused\b/i
  ]

  for (const pattern of noLikePatterns) {
    if (pattern.test(lowerCleanMsg)) {
      const noOption = options.find(opt => opt.toLowerCase() === 'no')
      if (noOption) {
        // Remove leading question phrases for notes
        const notes = cleanMsg.replace(pattern, '').replace(/^(please|can|could|may|am i|i'm|im)\s*/i, '').trim()
        return { option: noOption, notes: notes || undefined }
      }
    }
  }

  // Check for explicit "no" patterns (even with emojis)
  if (/^(no|nope|nah|naw|n)\s*[💔❤️💕😢😭😔]?$/i.test(message.trim()) || 
      /^(no|nope|nah|naw|n)\s*[💔❤️💕😢😭😔]?$/i.test(cleanMsg.trim())) {
    const noOption = options.find(opt => opt.toLowerCase() === 'no')
    if (noOption) {
      return { option: noOption }
    }
  }
  
  // Check for explicit "yes" patterns
  if (/^(yes|yep|yeah|ya|y)\s*[❤️💕😊👍]?$/i.test(message.trim()) || 
      /^(yes|yep|yeah|ya|y)\s*[❤️💕😊👍]?$/i.test(cleanMsg.trim())) {
    const yesOption = options.find(opt => opt.toLowerCase() === 'yes')
    if (yesOption) {
      return { option: yesOption }
    }
  }
  
  // Check for "maybe"
  if (/^(maybe|perhaps|might)\s*[?]?$/i.test(message.trim()) || 
      /^(maybe|perhaps|might)\s*[?]?$/i.test(cleanMsg.trim())) {
    const maybeOption = options.find(opt => opt.toLowerCase() === 'maybe')
    if (maybeOption) {
      return { option: maybeOption }
    }
  }
  
  // Standard keyword matching on cleaned message
  for (const opt of options) {
    if (lowerCleanMsg.includes(opt.toLowerCase())) {
      // Extract notes (anything after the option)
      const optIndex = lowerCleanMsg.indexOf(opt.toLowerCase());
      const afterOption = cleanMsg.substring(optIndex + opt.length).trim();
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
    // Normalize phone to match how it's stored (remove +1 prefix if present)
    const normalizedPhone = phone.replace(/^\+?1?/, '')
    
    // Check if we have a name in sms_poll_response
    const { data: existing } = await supabaseAdmin
      .from('sms_poll_response')
      .select('person_name')
      .eq('phone', normalizedPhone)
      .not('person_name', 'is', null)
      .limit(1)
      .maybeSingle();

    if (existing?.person_name) {
      console.log(`[Polls] Found name in sms_poll_response: ${existing.person_name}`)
      return existing.person_name;
    }

    // Check sms_optin (where names are stored from SMS onboarding)
    const { data: optIn } = await supabaseAdmin
      .from('sms_optin')
      .select('name')
      .eq('phone', normalizedPhone)
      .not('name', 'is', null)
      .limit(1)
      .maybeSingle();

    if (optIn?.name && optIn.name !== normalizedPhone) {
      console.log(`[Polls] Found name in sms_optin: ${optIn.name}`)
      return optIn.name;
    }

    // Check app_user
    const { data: appUser } = await supabaseAdmin
      .from('app_user')
      .select('name')
      .ilike('phone', `%${normalizedPhone.slice(-10)}%`)
      .limit(1)
      .maybeSingle();

    if (appUser?.name) {
      console.log(`[Polls] Found name in app_user: ${appUser.name}`)
      return appUser.name;
    }

    console.log(`[Polls] No name found for phone: ${normalizedPhone}`)
    return null;
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
 * Update name everywhere (Supabase + Airtable)
 * Exported for use in SMS handler
 */
export async function updateNameEverywhere(phone: string, name: string): Promise<void> {
  console.log(`[Name Collection] updateNameEverywhere: phone=${phone}, name="${name}"`)
  
  try {
    // 1. Update sms_optin table
    const normalizedPhone = normalizePhoneForAirtable(phone).replace('+', '')
    console.log(`[Name Collection] updateNameEverywhere: Updating sms_optin with normalized phone=${normalizedPhone}`)
    
    const { error: optinError } = await supabaseAdmin
      .from('sms_optin')
      .update({ name: name, needs_name: false, updated_at: new Date().toISOString() } as any)
      .eq('phone', normalizedPhone);
    
    if (optinError) {
      console.error(`[Name Collection] updateNameEverywhere: ✗ Failed to update sms_optin:`, JSON.stringify(optinError, null, 2))
    } else {
      console.log(`[Name Collection] updateNameEverywhere: ✓ Updated sms_optin`)
    }

    // 2. Update all sms_poll_response records for this phone
    console.log(`[Name Collection] updateNameEverywhere: Updating sms_poll_response records`)
    const { error: pollResponseError } = await supabaseAdmin
      .from('sms_poll_response')
      .update({ person_name: name } as any)
      .eq('phone', phone);
    
    if (pollResponseError) {
      console.error(`[Name Collection] updateNameEverywhere: ✗ Failed to update sms_poll_response:`, JSON.stringify(pollResponseError, null, 2))
    } else {
      console.log(`[Name Collection] updateNameEverywhere: ✓ Updated sms_poll_response records`)
    }

    // 3. Update Airtable record (upsert by phone number)
    console.log(`[Name Collection] updateNameEverywhere: Checking Airtable config: API_KEY=${!!ENV.AIRTABLE_API_KEY}, BASE_ID=${!!ENV.AIRTABLE_BASE_ID}, TABLE_NAME=${!!ENV.AIRTABLE_TABLE_NAME}`)
    
    if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
      const personFieldName = ENV.AIRTABLE_PERSON_FIELD || 'Person'
      console.log(`[Name Collection] updateNameEverywhere: Upserting Airtable: base=${ENV.AIRTABLE_BASE_ID}, table=${ENV.AIRTABLE_TABLE_NAME}, phone=${phone}, field=${personFieldName}, name="${name}"`)
      
      const result = await upsertAirtableRecord(
        ENV.AIRTABLE_BASE_ID,
        ENV.AIRTABLE_TABLE_NAME,
        phone,
        { [personFieldName]: name }
      );

      if (result.ok) {
        console.log(`[Name Collection] updateNameEverywhere: ✓ Updated name in Airtable for ${phone} to "${name}" (record ID: ${result.id || 'none'})`);
      } else {
        console.error(`[Name Collection] updateNameEverywhere: ✗ Failed to update name in Airtable: ${result.error}`);
      }
    } else {
      console.warn(`[Name Collection] updateNameEverywhere: Skipping Airtable update - missing config`);
    }

    console.log(`[Name Collection] updateNameEverywhere: ✓ Completed updating name "${name}" everywhere for phone ${phone}`);
  } catch (err) {
    console.error('[Name Collection] updateNameEverywhere: ✗ Exception:', err);
    if (err instanceof Error) {
      console.error(`[Name Collection] updateNameEverywhere: Exception details: ${err.message}\n${err.stack}`)
    }
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

    // Update or create Airtable record using new upsert helper
    if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
      // Use dynamic field names from poll (if they exist), otherwise use defaults
      const questionField = poll.airtable_question_field || 'Question';
      const responseField = poll.airtable_response_field || 'Response';
      const notesField = poll.airtable_notes_field || 'Notes';

      // Get field names from env (with defaults)
      const personFieldName = ENV.AIRTABLE_PERSON_FIELD || 'Person'
      
      // Build fields object - start with required fields only
      // We'll add poll-specific fields, but if they fail (don't exist), we'll create record with just Person
      const fields: Record<string, any> = {
        [personFieldName]: personName || 'Unknown'
      };

      // Try to add poll-specific fields if they were configured
      // If they don't exist in Airtable, the upsert will fail for those fields, but we can retry with just Person
      const pollFieldsToAdd: Record<string, any> = {}
      
      if (poll.airtable_question_field) {
        pollFieldsToAdd[questionField] = poll.question; // Store the poll question
        console.log(`[Polls] Including field: ${questionField} = "${poll.question.substring(0, 50)}..."`)
      } else {
        console.warn(`[Polls] Poll ${pollId} has no airtable_question_field configured - fields may not have been created when poll was sent`)
      }
      
      if (poll.airtable_response_field) {
        pollFieldsToAdd[responseField] = option;
        console.log(`[Polls] Including field: ${responseField} = "${option}"`)
      } else {
        console.warn(`[Polls] Poll ${pollId} has no airtable_response_field configured - fields may not have been created when poll was sent`)
      }
      
      if (poll.airtable_notes_field && notes) {
        pollFieldsToAdd[notesField] = notes;
        console.log(`[Polls] Including field: ${notesField} = "${notes.substring(0, 50)}..."`)
      } else if (notes) {
        console.warn(`[Polls] Poll ${pollId} has no airtable_notes_field configured - notes will not be saved`)
      }
      
      // Add poll fields to main fields object
      Object.assign(fields, pollFieldsToAdd)

      // Upsert with all fields (including poll-specific)
      // Fields should have been created when poll was sent, so this should work
      const result = await upsertAirtableRecord(
        ENV.AIRTABLE_BASE_ID,
        ENV.AIRTABLE_TABLE_NAME,
        phone,
        fields
      );

      if (result.ok) {
        const fieldCount = Object.keys(fields).length
        const pollFieldCount = Object.keys(pollFieldsToAdd).length
        console.log(`[Polls] ${result.created ? 'Created' : 'Updated'} Airtable record for ${phone} (${personName || 'Unknown'})`)
        if (pollFieldCount > 0) {
          console.log(`[Polls] Record includes ${pollFieldCount} poll-specific fields out of ${fieldCount} total fields`)
        }
      } else {
        console.error(`[Polls] Failed to upsert Airtable record:`, result.error);
        console.error(`[Polls] Base: ${ENV.AIRTABLE_BASE_ID}, Table: ${ENV.AIRTABLE_TABLE_NAME}`);
        console.error(`[Polls] Fields attempted: ${Object.keys(fields).join(', ')}`);
        // Graceful fallback: retry with minimal fields only (Person)
        try {
          const minimalFields: Record<string, any> = { [personFieldName]: personName || 'Unknown' }
          const retry = await upsertAirtableRecord(
            ENV.AIRTABLE_BASE_ID,
            ENV.AIRTABLE_TABLE_NAME,
            phone,
            minimalFields
          )
          if (!retry.ok) {
            console.warn('[Polls] Minimal Airtable upsert also failed; continuing without Airtable.')
          } else {
            console.log('[Polls] ✓ Minimal Airtable upsert succeeded after field error')
          }
        } catch (e) {
          console.warn('[Polls] Airtable fallback threw error; continuing:', e as any)
        }
      }
    } else {
      console.warn('[Polls] Airtable not configured - missing API key, base ID, or table name');
    }

    return true;
  } catch (err) {
    console.error('[Polls] Failed to record response:', err);
    return false;
  }
}

