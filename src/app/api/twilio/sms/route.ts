import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabase, supabaseAdmin } from '@/lib/supabase'
import { airtableInsert } from '@/lib/airtable'
import { searchResourcesHybrid } from '@/lib/search'
import { ENV } from '@/lib/env'
import { sendSms, normalizeE164 } from '@/lib/sms'
import { planQuery, executePlan, composeResponse } from '@/lib/planner'
import { 
  isAnnouncementRequest, 
  isDraftModification, 
  isExactTextRequest,
  extractAnnouncementDetails, 
  generateAnnouncementDraft, 
  saveDraft, 
  getActiveDraft,
  sendAnnouncement,
  getPreviousAnnouncements,
  extractRawAnnouncementText
} from '@/lib/announcements'
import {
  isPollRequest,
  extractPollDetails,
  generatePollQuestion,
  savePollDraft,
  getActivePollDraft,
  sendPoll,
  parseResponseWithNotes,
  getOrAskForName,
  saveName,
  updateNameEverywhere,
  recordPollResponse
} from '@/lib/polls'
import { classifyIntent } from '@/lib/router'
import { retrieveContent } from '@/lib/retrievers/content'
import { retrieveConvo } from '@/lib/retrievers/convo'
import { retrieveEnclave } from '@/lib/retrievers/enclave'
import { retrieveAction } from '@/lib/retrievers/action'
import { combine } from '@/lib/combiner'
import { applyTone } from '@/lib/tone'
import { decideTone } from '@/lib/tone/engine'
import { detectProfanity, guessInsultTarget } from '@/lib/tone/detect'
import { earlyClassify } from '@/lib/nlp/earlyClassify'
import { enclaveConciseAnswer } from '@/lib/enclave/answers'
import { smsTighten } from '@/lib/text/limits'

// Feature flag: Enable new planner-based flow
const USE_PLANNER = true

// Check if message is a send affirmation (but NOT if it's a poll response)
const isSendAffirmation = (message: string, isPollResponseContext: boolean = false): boolean => {
  if (isPollResponseContext) return false // Never treat poll responses as send commands
  const lower = message.trim().toLowerCase()
  // Exclude "yes" if it's likely a poll response (short, single word)
  if (lower === 'yes' || lower === 'no' || lower === 'maybe') return false
  return ['send', 'yep', 'yea', 'yeah', 'ok', 'okay', 'go', 'do it', 'all good', 'looks good', 'perfect', 'good'].includes(lower)
}

// Check if message is name declaration using AI
async function isNameDeclaration(message: string): Promise<{ isName: boolean; name?: string }> {
  try {
    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`;
    const aiRes = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Is this message a person declaring their name? "${message}"

Return JSON: {"isName": true/false, "name": "extracted name or null"}

Examples:
"i'm saathvik" → {"isName":true,"name":"saathvik"}
"my name is john" → {"isName":true,"name":"john"}
"call me mike" → {"isName":true,"name":"mike"}
"i'm confused" → {"isName":false}
"send it" → {"isName":false}
"yes" → {"isName":false}

ONLY return true if they're clearly stating their name. Return JSON only.`,
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
        return { isName: parsed.isName || false, name: parsed.name || undefined };
      }
    }
  } catch (err) {
    console.error('[Name Detection] Failed:', err);
  }
  return { isName: false };
}

// Check if query is about Enclave itself
const isEnclaveQuery = (query: string): boolean => {
  const lowerQuery = query.toLowerCase()
  return lowerQuery.includes('what is enclave') || 
         lowerQuery.includes('what does enclave') || 
         lowerQuery.includes('what\'s enclave') ||
         lowerQuery.includes('enclave features') || 
         lowerQuery.includes('enclave capabilities') ||
         lowerQuery.includes('what can enclave') ||
         lowerQuery.includes('enclave is terrible') ||
         lowerQuery.includes('enclave sucks')
}

// LLM query classifier to determine if query is about content, enclave, or neither
const classifyQuery = async (query: string, searchResultsCount: number): Promise<'content' | 'enclave' | 'chat'> => {
  try {
    // If we found results, it's definitely a content query
    if (searchResultsCount > 0) {
      return 'content'
    }
    
    // Call AI to classify the query
    const aiRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Classify this query into exactly one category: "content", "enclave", or "chat". 
        
Query: "${query}"

Content means asking about documents/events/resources in the knowledge base.
Enclave means asking about what Enclave is/how it works.
Chat means anything else - greetings, complaints, random conversation.

Respond with ONLY the category word:`,
        context: '',
        type: 'general'
      })
    })
    
    if (aiRes.ok) {
      const aiData = await aiRes.json()
      const response = aiData.response?.toLowerCase().trim() || 'chat'
      
      if (response.includes('content')) return 'content'
      if (response.includes('enclave')) return 'enclave'
      return 'chat'
    }
  } catch (err) {
    console.error('[Twilio SMS] AI classifier failed:', err)
  }
  
  // Fallback to checking if it's about Enclave
  return isEnclaveQuery(query) ? 'enclave' : 'chat'
}

// Split long messages at sentence boundaries into multiple messages
const splitLongMessage = (message: string, maxLength: number = 1600): string[] => {
  if (message.length <= maxLength) {
    return [message]
  }
  
  const messages: string[] = []
  let remaining = message
  
  while (remaining.length > maxLength) {
    // Find the last sentence boundary within maxLength
    let splitPoint = maxLength
    const searchText = remaining.substring(0, maxLength)
    
    // Try to find sentence endings (with space after, or at end of text)
    const periodWithSpace = searchText.lastIndexOf('. ')
    const periodAtEnd = searchText.endsWith('.') ? searchText.length - 1 : -1
    const lastPeriod = Math.max(periodWithSpace, periodAtEnd)
    
    const questionWithSpace = searchText.lastIndexOf('? ')
    const questionAtEnd = searchText.endsWith('?') ? searchText.length - 1 : -1
    const lastQuestion = Math.max(questionWithSpace, questionAtEnd)
    
    const exclamationWithSpace = searchText.lastIndexOf('! ')
    const exclamationAtEnd = searchText.endsWith('!') ? searchText.length - 1 : -1
    const lastExclamation = Math.max(exclamationWithSpace, exclamationAtEnd)
    
    const lastNewline = searchText.lastIndexOf('\n')
    
    // Use the latest sentence boundary (only if reasonable length to avoid tiny messages)
    const minBoundary = maxLength * 0.5
    const boundaries = [lastPeriod, lastNewline, lastQuestion, lastExclamation].filter(b => b >= minBoundary)
    
    if (boundaries.length > 0) {
      const bestBoundary = Math.max(...boundaries)
      // If boundary is period/question/exclamation with space after, split after the space
      // If boundary is at end of text, split after the punctuation
      if (periodWithSpace === bestBoundary || questionWithSpace === bestBoundary || exclamationWithSpace === bestBoundary) {
        splitPoint = bestBoundary + 2 // Skip punctuation and space
      } else {
        splitPoint = bestBoundary + 1 // Skip just the punctuation
      }
    } else {
      // No good boundary found - split at word boundary if possible
      const lastSpace = searchText.lastIndexOf(' ')
      if (lastSpace >= minBoundary) {
        splitPoint = lastSpace + 1
      }
      // Otherwise split at maxLength (better than truncating)
    }
    
    messages.push(remaining.substring(0, splitPoint).trim())
    remaining = remaining.substring(splitPoint).trim()
  }
  
  if (remaining.length > 0) {
    messages.push(remaining)
  }
  
  return messages
}

// Force dynamic rendering for webhooks
export const dynamic = 'force-dynamic'

// Twilio webhook signature validation
const validateRequest = async (formData: FormData, signature: string, url: string) => {
  const authToken = ENV.TWILIO_AUTH_TOKEN
  
  if (!authToken) {
    console.error('[Twilio SMS] Missing TWILIO_AUTH_TOKEN environment variable')
    return false
  }

  if (!signature) {
    console.error('[Twilio SMS] Missing signature header')
    return false
  }

  try {
    const params = Object.fromEntries(formData.entries())
    
    return twilio.validateRequest(
      authToken,
      signature,
      url,
      params as Record<string, string>
    )
  } catch (error) {
    console.error('[Twilio SMS] Signature validation error:', error)
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    // Read form data once
    const formData = await request.formData()
    const twilioSignature = request.headers.get('x-twilio-signature')
    const url = request.url.split('?')[0] // Remove query params for validation
    
    // Validate Twilio signature
    const isValid = await validateRequest(formData, twilioSignature || '', url)
    
    if (!isValid) {
      console.error('[Twilio SMS] Invalid request signature')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const from = formData.get('From') as string
    const to = formData.get('To') as string
    const body = formData.get('Body') as string

    console.log(`[Twilio SMS] Received message from ${from}: "${body}"`)

    // Normalize phone number - ensure consistent formatting
    // Twilio sends E.164 format like +14089133065 or +13853687238
    const phoneNumber = from.startsWith('+1') ? from.substring(2) : from.replace(/[^\d]/g, '')
    
    console.log(`[Twilio SMS] Phone normalization: ${from} → ${phoneNumber}`)

    // Check if user exists in sms_optin table at ALL (not filtered by opted_out)
    const { data: optInDataAll, error: optInError } = await supabase
      .from('sms_optin')
      .select('*')
      .eq('phone', phoneNumber)
      .maybeSingle()
    
    console.log(`[Twilio SMS] optInDataAll lookup result: ${optInDataAll ? 'FOUND' : 'NOT FOUND'}`)

    // AUTO-OPT-IN: Check if user is opted in, if not, auto-opt them in with sassy message
    const { data: optInData } = await supabase
      .from('sms_optin')
      .select('*')
      .eq('phone', phoneNumber)
      .eq('opted_out', false)
      .single()

    // Handle commands: STOP, HELP first (before checking if new user)
    const command = body?.trim().toUpperCase()

    // ============ NAME DETECTION (HIGHEST PRIORITY) ============
    // Check if user is declaring their name - but NOT if it's a question about the bot's name
    const isBotNameQuestion = /(is\s+this\s+jarvis|are\s+you\s+jarvis|is\s+this\s+enclave|are\s+you\s+enclave)/i.test(body)
    if (!isBotNameQuestion) {
      const nameCheck = await isNameDeclaration(body)
      if (nameCheck.isName && nameCheck.name) {
        console.log(`[Twilio SMS] Name declared: ${nameCheck.name} for ${phoneNumber}`)
        
        // Update sms_optin first to ensure needs_name is cleared
        // Use phoneNumber (already normalized) to match how the table stores it
        const { error: updateError } = await supabase
          .from('sms_optin')
          .update({ 
            name: nameCheck.name,
            needs_name: false,
            updated_at: new Date().toISOString()
          })
          .eq('phone', phoneNumber)
        
        if (updateError) {
          console.error(`[Twilio SMS] Error updating sms_optin for name:`, updateError)
        } else {
          console.log(`[Twilio SMS] Updated sms_optin: set name="${nameCheck.name}", needs_name=false for ${phoneNumber}`)
        }
        
        // Update name everywhere (Supabase poll responses + Airtable)
        await updateNameEverywhere(from, nameCheck.name)
        
        const introMsg = `got it! i'll call you ${nameCheck.name}. i'm jarvis — i can help you find info about events, docs, and more. try asking "what's happening this week" or any question you have!`
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${introMsg}</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    }
    
    // Send affirmation handling moved to PRIORITY 0 above (after context detection)

    // Check if this is the "SEP" keyword (legacy, still supported but auto-opt-in is now automatic)
    if (command === 'SEP') {
      // Just start a query session
      await supabase
        .from('sms_query_session')
        .upsert({
          phone_number: phoneNumber,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Message>Ready to search! Type your question.</Message></Response>',
        { 
          headers: { 'Content-Type': 'application/xml' }
        }
      )
    }
    
    if (command === 'STOP') {
      // Opt out the user
      await supabase
        .from('sms_optin')
        .update({ 
          opted_out: true,
          opted_out_timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('phone', phoneNumber)

      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Message>You have been unsubscribed from Enclave notifications. Text START to resubscribe.</Message></Response>',
        { 
          headers: { 'Content-Type': 'application/xml' }
        }
      )
    }

    if (command === 'START') {
      // Resubscribe the user (restore opted_out = false)
      await supabase
        .from('sms_optin')
        .update({ 
          opted_out: false,
          consent_timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('phone', phoneNumber)

      // Start query session
      await supabase
        .from('sms_query_session')
        .upsert({
          phone_number: phoneNumber,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Message>You have been re-subscribed. Ask me anything about your resources!</Message></Response>',
        { 
          headers: { 'Content-Type': 'application/xml' }
        }
      )
    }

    if (command === 'HELP') {
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Message>Enclave SMS Help:\n\n• Text SEP followed by your question to search resources\n• Text STOP to opt out\n• Text HELP for this message\n\nReply STOP to unsubscribe.</Message></Response>',
        { 
          headers: { 'Content-Type': 'application/xml' }
        }
      )
    }

    // ========================================================================
    // COMMAND: CREATE POLL / ANNOUNCEMENT BLAST FROM SMS
    // ========================================================================
    try {
      const lower = (body || '').trim().toLowerCase()
      const wantsPoll = lower.includes('poll') || lower.includes('rsvp')
      const wantsBlast = lower.includes('blast') || lower.includes('text blast') || lower.includes('send to everyone')
      const wantsAnnouncement = lower.includes('announcement') && !wantsPoll

      if (wantsBlast && (wantsPoll || wantsAnnouncement)) {
        const question = (body || '').trim()
        const defaultOptions = ['Yes', 'No', 'Maybe']

        // Find spaces for this phone (robust match on last 10 digits)
        const digits = phoneNumber // already last-10 US digits
        const dbClientOuter = supabaseAdmin || supabase
        const { data: membershipCandidates } = await dbClientOuter
          .from('app_user')
          .select('space_id, phone')
        const normalizeDigits = (p: any) => String(p || '').replace(/[^\d]/g, '').slice(-10)
        const spaceIds = Array.from(new Set(
          (membershipCandidates || [])
            .filter(r => normalizeDigits(r.phone) === digits)
            .map(r => r.space_id)
        ))
        if (spaceIds.length === 0) {
          return new NextResponse(
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Response><Message>No space found for your phone. Add your phone to your group settings.</Message></Response>',
            { headers: { 'Content-Type': 'application/xml' } }
          )
        }

        const dbClient = supabaseAdmin || supabase
        let totalRecipients = 0
        let lastCode: string | null = null

        for (const spaceId of spaceIds) {
          const { data: members } = await dbClientOuter
            .from('app_user')
            .select('phone')
            .eq('space_id', spaceId)
          const phones = (members || []).map(m => m.phone).filter(Boolean).map(p => normalizeE164(String(p)))
          const unique = Array.from(new Set(phones))
          const { data: optins } = await dbClientOuter
            .from('sms_optin')
            .select('phone, opted_out')
            .in('phone', unique)
          const optedOut = new Set((optins || []).filter(o => o.opted_out).map(o => o.phone))
          const recipients = unique.filter(p => !optedOut.has(p))
          if (recipients.length === 0) continue

          let finalMessage = question
          let pollId: string | null = null
          let code: string | null = null
          if (wantsPoll) {
            const makeCode = () => Math.random().toString(36).slice(2, 6).toUpperCase()
            for (let i = 0; i < 3; i++) {
              const tryCode = makeCode()
              const { data: exists } = await supabase
                .from('sms_poll')
                .select('id')
                .eq('code', tryCode)
                .maybeSingle()
              if (!exists) { code = tryCode; break }
            }
            if (!code) code = makeCode()
            const { data: created } = await dbClient
              .from('sms_poll')
              .insert({ space_id: spaceId, question, options: defaultOptions, code, created_by: 'sms' } as any)
              .select('id, code')
              .single()
            pollId = created?.id || null
            lastCode = created?.code || code

            const lines = defaultOptions.map((opt, idx) => `${idx + 1}) ${opt}`)
            const rawResultsUrl = process.env.AIRTABLE_PUBLIC_RESULTS_URL
            const sanitizedResultsUrl = rawResultsUrl?.replace(/^@+/, '')
            const publicResultsUrl = sanitizedResultsUrl || (process.env.AIRTABLE_BASE_ID ? `https://airtable.com/${process.env.AIRTABLE_BASE_ID}` : undefined)
            const link = publicResultsUrl ? `\nView results: ${publicResultsUrl} (search code ${lastCode})` : ''
            finalMessage = `POLL (${lastCode}): ${question}\nReply with number or option word:\n${lines.join('\n')}${link}`
          }

          for (const to of recipients) {
            const res = await sendSms(to, finalMessage)
            await dbClient.from('sms_message_log').insert({ phone: to, message: finalMessage, status: res.ok ? 'queued' : 'failed', twilio_sid: res.sid || null } as any)
            if (wantsPoll && pollId) {
              await dbClient.from('sms_poll_response').upsert({ poll_id: pollId, phone: to, option_index: 0, option_label: '' } as any, { onConflict: 'poll_id,phone' } as any)
            }
          }

          totalRecipients += recipients.length
        }

        const rawResultsUrl = process.env.AIRTABLE_PUBLIC_RESULTS_URL
        const sanitizedResultsUrl = rawResultsUrl?.replace(/^@+/, '')
        const publicResultsUrl = sanitizedResultsUrl || (process.env.AIRTABLE_BASE_ID ? `https://airtable.com/${process.env.AIRTABLE_BASE_ID}` : undefined)
        const summary = wantsPoll
          ? `Poll sent to ${totalRecipients} members. Code ${lastCode || ''}.${publicResultsUrl ? `\nView results: ${publicResultsUrl}` : ''}`
          : `Announcement sent to ${totalRecipients} members.`

        return new NextResponse(
          '<?xml version="1.0" encoding="UTF-8"?>' +
          `<Response><Message>${summary}</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    } catch (e) {
      console.error('[Twilio SMS] Blast command failed:', e)
    }

    // ========================================================================
    // CONTEXT-AWARE ROUTING
    // ========================================================================
    // First, check conversation history to determine context
    const { data: conversationHistory } = await supabase
      .from('sms_conversation_history')
      .select('user_message, bot_response')
      .eq('phone_number', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(3)
    
    const recentMessages = conversationHistory || []
    const lastBotMessage = recentMessages[0]?.bot_response || ''
    const lastUserMessage = recentMessages[0]?.user_message || ''
    const contextMessages = recentMessages.map(m => `${m.user_message} ${m.bot_response}`).join(' ').toLowerCase()
    
    // Determine context
    const isPollDraftContext = 
      lastBotMessage.includes('what the poll will say') ||
      lastBotMessage.includes('reply "send it" to send') ||
      lastBotMessage.includes('reply to edit') ||
      contextMessages.includes('poll will say')
    
    const isPollQuestionInputContext =
      lastBotMessage.includes('what would you like to ask in the poll') ||
      lastBotMessage === 'what would you like to ask in the poll?'
    
    const isAnnouncementDraftContext =
      lastBotMessage.includes('what the announcement will say') ||
      lastBotMessage.includes('reply "send it" to broadcast') ||
      contextMessages.includes('announcement will say') ||
      contextMessages.includes('make an announcement')
    
    // Check if user has an active poll waiting for response
    const phoneE164 = from.startsWith('+') ? from : `+1${phoneNumber}`
    const { data: pendingPollResponse } = await supabase
      .from('sms_poll_response')
      .select('sms_poll!inner(id, question, options, code, created_at, sent_at)')
      .eq('phone', phoneE164)
      .eq('response_status', 'pending')
      .order('sms_poll(created_at)', { ascending: false })
      .limit(1)
      .maybeSingle()
    
    const hasActivePoll = pendingPollResponse?.sms_poll && pendingPollResponse.sms_poll.sent_at
    
    // Only treat as poll-response context if there is a pending poll awaiting this user's reply
    const isPollResponseContext = !!hasActivePoll
    
    const textRaw = (body || '').trim()
    const lowerBody = textRaw.toLowerCase()
    const activePollDraft = await getActivePollDraft(phoneNumber)
    const activeDraft = await getActiveDraft(phoneNumber)
    
    // ========================================================================
    // PRIORITY 0: Send command (HIGHEST - before everything else, but NOT if responding to poll)
    // ========================================================================
    if ((command === 'SEND IT' || command === 'SEND NOW' || isSendAffirmation(textRaw, isPollResponseContext)) && !isPollResponseContext && !isPollQuestionInputContext) {
      // Get both drafts and send the most recent one
      const pollDraftCheck = activePollDraft || await getActivePollDraft(phoneNumber)
      const announcementDraftCheck = activeDraft || await getActiveDraft(phoneNumber)
      
      // Determine which is more recent
      let shouldSendPoll = false
      if (pollDraftCheck && announcementDraftCheck) {
        const pollTime = new Date(pollDraftCheck.updatedAt || pollDraftCheck.createdAt || 0).getTime()
        const announcementTime = new Date(announcementDraftCheck.scheduledFor || announcementDraftCheck.updatedAt || 0).getTime()
        shouldSendPoll = pollTime > announcementTime
      } else if (pollDraftCheck) {
        shouldSendPoll = true
      }
      
      if (shouldSendPoll && pollDraftCheck && pollDraftCheck.id) {
        console.log(`[Twilio SMS] Sending poll ${pollDraftCheck.id}`)
        const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
        const { sentCount, airtableLink } = await sendPoll(pollDraftCheck.id, twilioClient)
        const linkText = airtableLink ? `\n\nview results: ${airtableLink}` : ''
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>sent poll to ${sentCount} people 📊${linkText}</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else if (announcementDraftCheck && announcementDraftCheck.id) {
        console.log(`[Twilio SMS] Sending announcement ${announcementDraftCheck.id}`)
        const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
        const sentCount = await sendAnnouncement(announcementDraftCheck.id, twilioClient)
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>sent to ${sentCount} people 📢</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else {
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>no draft found. create an announcement or poll first</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    }
    
    // Helper: strict poll answer detector (numbers or exact option words, small input)
    const isLikelyPollAnswer = (input: string, options: string[] | undefined): boolean => {
      const t = (input || '').trim().toLowerCase()
      if (t.length === 0) return false
      // Hard toxicity words should never be treated as poll answers
      if (/(retard|retarded|idiot|stupid|dumb)/.test(t)) return false
      // Pure number mapping
      const num = t.match(/^\s*(\d{1,2})\s*$/)
      if (num && options && options.length > 0) {
        const idx = parseInt(num[1], 10) - 1
        return idx >= 0 && idx < options.length
      }
      // Exact short option word match (allow basic punctuation)
      const cleaned = t.replace(/[^a-z0-9\s]/g, '').trim()
      if (options) {
        for (const opt of options) {
          const oc = String(opt || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
          if (oc && cleaned === oc) return true
        }
      }
      // Very short yes/no/maybe
      if (['yes', 'no', 'maybe', 'y', 'n'].includes(cleaned) && (!options || options.length <= 5)) return true
      return false
    }

    // ========================================================================
    // PRIORITY 1: Poll Response (HIGH - before queries)
    // ========================================================================
    if (isPollResponseContext && !isPollDraftContext && !isPollQuestionInputContext && !isPollRequest(textRaw) && !isAnnouncementRequest(textRaw)) {
      try {
        const upper = textRaw.toUpperCase()
        const codeMatch = upper.match(/\b([A-Z0-9]{4})\b/)
        
        // Find poll by code or use pending poll
        let poll: any = null
        if (codeMatch) {
          const dbClient = supabaseAdmin || supabase
          const { data: p } = await dbClient
            .from('sms_poll')
            .select('id, space_id, question, options, code, created_at')
            .eq('code', codeMatch[1])
            .maybeSingle()
          poll = p
        } else if (pendingPollResponse?.sms_poll) {
          poll = pendingPollResponse.sms_poll
        } else {
          // Fallback: find latest poll for this phone
          const dbClient = supabaseAdmin || supabase
          const { data: rows } = await dbClient
            .from('sms_poll_response')
            .select('poll_id, sms_poll!inner(id, space_id, question, options, code, created_at)')
            .eq('phone', phoneE164)
            .order('sms_poll(created_at)', { ascending: false })
            .limit(1)
            .maybeSingle()
          poll = rows?.sms_poll || null
        }
        
        if (poll && Array.isArray(poll.options)) {
          const options: string[] = poll.options as string[]

          // Router-aware guard: classify high-level intent, and strictly validate poll answer
          const routePre = classifyIntent(textRaw, contextMessages)
          const looksLikeAnswer = isLikelyPollAnswer(textRaw, options)
          if (!looksLikeAnswer || routePre.intent === 'abusive' || routePre.intent === 'smalltalk' || routePre.intent === 'enclave_help') {
            // Not a clean poll answer — fall through to other handlers
            console.log('[Twilio SMS] Not treating message as poll response (failed strict check or intent)')
            throw new Error('NotAPollAnswer')
          }
          
          // Get name
          const normalizedPhone = phoneE164.replace('+1', '').replace('+', '')
          const { data: optinData } = await supabase
            .from('sms_optin')
            .select('name')
            .eq('phone', normalizedPhone)
            .maybeSingle()
          
          let personName = optinData?.name || 'Unknown'
          console.log(`[Twilio SMS] Poll response from ${normalizedPhone}, name: ${personName}`)
          
          // Parse response
          const parsed = await parseResponseWithNotes(body, options)
          
          if (parsed.option) {
            // Successfully parsed - record it
            const success = await recordPollResponse(
              poll.id,
              phoneE164,
              parsed.option,
              parsed.notes,
              personName
            )
            
            if (!success) {
              return new NextResponse(
                '<?xml version="1.0" encoding="UTF-8"?>' +
                '<Response><Message>Sorry, there was an error recording your response. Please try again.</Message></Response>',
                { headers: { 'Content-Type': 'application/xml' } }
              )
            }
            
            const rawResultsUrl = process.env.AIRTABLE_PUBLIC_RESULTS_URL
            const sanitizedResultsUrl = rawResultsUrl?.replace(/^@+/, '')
            const publicResultsUrl = sanitizedResultsUrl || undefined
            const linkLine = publicResultsUrl ? `\n\nView results: ${publicResultsUrl}` : ''
            const notesText = parsed.notes ? ` (note: ${parsed.notes})` : ''
            const sassy = [
              `got you, ${personName}. marked: ${parsed.option}${notesText}`,
              `copy that ${personName} — logged ${parsed.option}${notesText}`,
              `${personName}, noted: ${parsed.option}${notesText}`,
              `all right ${personName}, putting you down as ${parsed.option}${notesText}`
            ]
            const reply = `${sassy[Math.floor(Math.random()*sassy.length)]}${linkLine}`
            
            return new NextResponse(
              '<?xml version="1.0" encoding="UTF-8"?>' +
              `<Response><Message>${reply}</Message></Response>`,
              { headers: { 'Content-Type': 'application/xml' } }
            )
          } else {
            // Couldn't parse - might be a command, fall through
            console.log('[Twilio SMS] Could not parse poll response, falling through')
          }
        }
      } catch (err) {
        console.error('[Twilio SMS] Poll response handling error:', err)
        // Fall through to other handlers
      }
    }
    
    // ========================================================================
    // PRIORITY 2: Poll Question Input (after "what would you like to ask in the poll?")
    // ========================================================================
    if (isPollQuestionInputContext && !isPollRequest(textRaw) && !isAnnouncementRequest(textRaw) && textRaw.length < 200) {
      console.log(`[Twilio SMS] Poll question input detected: "${textRaw}"`)
      
      // Extract question - check for quotes
      const quoteMatch = textRaw.match(/"([^"]+)"/)
      let question = quoteMatch ? quoteMatch[1] : textRaw.trim()
      
      if (!question || question.length === 0) {
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>what would you like to ask in the poll?</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
      
      // Generate conversational question
      const draftQuestion = await generatePollQuestion({ question, tone: 'casual' })
      
      // Save draft
      const spaceIds = await getWorkspaceIds()
      const draftId = await savePollDraft(phoneNumber, {
        question: draftQuestion,
        options: ['Yes', 'No', 'Maybe'],
        tone: 'casual',
        workspaceId: spaceIds[0]
      }, spaceIds[0])
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>okay here's what the poll will say:\n\n${draftQuestion}\n\nreply "send it" to send or reply to edit the message</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // ========================================================================
    // PRIORITY 3: Query Detection - Answer queries even if drafts exist
    // ========================================================================
    // Check if this looks like a content query (not draft-related)
    const looksLikeQuery = 
      lowerBody.includes('when is') ||
      lowerBody.includes('what is') ||
      lowerBody.includes('where is') ||
      lowerBody.includes('who is') ||
      lowerBody.includes('how') ||
      lowerBody.startsWith('what\'s') ||
      lowerBody.startsWith('whats') ||
      (lowerBody.length > 20 && !lowerBody.includes('poll') && !lowerBody.includes('announcement') && !lowerBody.includes('no ') && !lowerBody.includes('actually'))
    
    // If it's a query, answer it FIRST, then mention drafts if any exist
    // This prevents queries from being treated as draft edits
    let queryAnswer: string | null = null
    let pendingPollFollowUp: string | null = null
    
    // Only treat as query if NOT in poll/question/draft contexts
    if (looksLikeQuery && !isPollDraftContext && !isAnnouncementDraftContext && !isPollResponseContext && !isPollQuestionInputContext) {
      // This is a query - handle it normally (code continues below to query handling)
      // We'll set a flag to add draft follow-up after
      console.log(`[Twilio SMS] Detected query "${textRaw}", will answer then check for drafts`)
      
      // Check for pending poll that user hasn't responded to
      const { data: pendingPoll } = await supabase
        .from('sms_poll_response')
        .select('sms_poll!inner(question, code, created_at)')
        .eq('phone', phoneE164)
        .eq('response_status', 'pending')
        .order('sms_poll(created_at)', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      if (pendingPoll?.sms_poll) {
        pendingPollFollowUp = pendingPoll.sms_poll.question || `Are you coming to ${pendingPoll.sms_poll.code || 'the event'}?`
      }
    }
    
    // ========================================================================
    // PRIORITY 1: Draft editing (only if in draft context AND not a query)
    // ========================================================================
    
    // Poll draft editing
    if (isPollDraftContext && activePollDraft && !isPollRequest(textRaw) && !isAnnouncementRequest(textRaw) && !looksLikeQuery) {
      console.log(`[Twilio SMS] Editing poll draft in context: "${textRaw}"`)
      
      // Check if it's a correction with quotes
      const quoteMatch = textRaw.match(/"([^"]+)"/)
      if (quoteMatch || lowerBody.includes('no ') || lowerBody.includes('actually') || lowerBody.includes('change')) {
        let newQuestion = quoteMatch ? quoteMatch[1] : textRaw.replace(/^(no|actually|change it to|make it)\s+/i, '').replace(/"/g, '')
        
        // Generate updated question
        const updatedQuestion = await generatePollQuestion({ question: newQuestion }, activePollDraft.question)
        
        // Save updated draft
        const spaceIds = await getWorkspaceIds()
        await savePollDraft(phoneNumber, {
          id: activePollDraft.id,
          question: updatedQuestion,
          options: activePollDraft.options,
          workspaceId: spaceIds[0]
        }, spaceIds[0])
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>updated:\n\n${updatedQuestion}\n\nreply "send it" to send</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    }
    
    // Announcement draft editing - handled in announcement context block below
    
    // Poll response handling moved to PRIORITY 1 above (removed duplicate)
    
    // ========================================================================
    // PRIORITY 3: Poll/Announcement Requests (if NOT in draft/question context)
    // ========================================================================
    if (!isPollDraftContext && !isAnnouncementDraftContext && !isPollQuestionInputContext) {
      // Poll request
      if (isPollRequest(textRaw)) {
        console.log(`[Twilio SMS] Poll request detected: "${textRaw}"`)
        
        // Extract poll details
        const details = await extractPollDetails(textRaw)
        
        // Check for quoted text - use verbatim
        const quoteMatch = textRaw.match(/"([^"]+)"/)
        let question = details.question || ''
        
        if (quoteMatch) {
          question = quoteMatch[1] // Use exact quoted text
        }
        
        if (!question || question.trim().length === 0) {
          // No question extracted - ask for it
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Message>what would you like to ask in the poll?</Message></Response>`,
            { headers: { 'Content-Type': 'application/xml' } }
          )
        }
        
        // Generate conversational question
        const draftQuestion = await generatePollQuestion({ question, tone: details.tone || 'casual' })
        
        // Save draft
        const spaceIds = await getWorkspaceIds()
        const draftId = await savePollDraft(phoneNumber, {
          question: draftQuestion,
          options: details.options || ['Yes', 'No', 'Maybe'],
          tone: details.tone,
          workspaceId: spaceIds[0]
        }, spaceIds[0])
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>okay here's what the poll will say:\n\n${draftQuestion}\n\nreply "send it" to send or reply to edit the message</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
      
      // Announcement request - handled below
    }
    
    // ========================================================================
    // ANNOUNCEMENT FLOW (only if in announcement context or explicitly requested)
    // ========================================================================
    
    // Helper to get workspace IDs
    async function getWorkspaceIds() {
      const { data: sepWorkspaces } = await supabase
        .from('space')
        .select('id, name')
        .ilike('name', '%SEP%')
      const unique = Array.from(new Set((sepWorkspaces || []).map(w => w.id)))
      // Keep just one workspace to avoid redundant searches
      return unique.slice(0, 1)
    }
    
    // Exact text request - handle BEFORE any draft modification or editing
    if (isExactTextRequest(body) && (activeDraft || activePollDraft) && !looksLikeQuery) {
      console.log(`[Twilio SMS] Using exact text for ${phoneNumber}`)
      
      if (activeDraft) {
        const exactText = extractRawAnnouncementText(body)
        console.log(`[Twilio SMS] Using exact text: "${exactText}"`)
        
        await saveDraft(phoneNumber, {
          id: activeDraft.id,
          content: exactText,
          tone: activeDraft.tone,
          scheduledFor: activeDraft.scheduledFor,
          targetAudience: activeDraft.targetAudience,
          workspaceId: activeDraft.workspaceId
        }, activeDraft.workspaceId!)
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>updated:\n\n${exactText}\n\nreply "send it" to broadcast</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else if (activePollDraft) {
        const exactText = extractRawAnnouncementText(body)
        
        const spaceIds = await getWorkspaceIds()
        await savePollDraft(phoneNumber, {
          id: activePollDraft.id,
          question: exactText,
          options: activePollDraft.options,
          tone: activePollDraft.tone,
          workspaceId: spaceIds[0]
        }, spaceIds[0])
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>updated:\n\n${exactText}\n\nreply "send it" to send</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    }
    
    // Announcement draft editing (only if in announcement context AND not a query)
    if (isAnnouncementDraftContext && activeDraft && !isPollRequest(textRaw) && !isAnnouncementRequest(textRaw) && !looksLikeQuery) {
      console.log(`[Twilio SMS] Editing announcement draft in context: "${textRaw}"`)
      
      const announcementText = extractRawAnnouncementText(body)
      
      // Edit existing draft
      await saveDraft(phoneNumber, {
        id: activeDraft.id,
        content: announcementText,
        tone: activeDraft.tone,
        scheduledFor: activeDraft.scheduledFor,
        targetAudience: activeDraft.targetAudience,
        workspaceId: activeDraft.workspaceId
      }, activeDraft.workspaceId!)
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>updated:\n\n${announcementText}\n\nreply "send it" to broadcast</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // Announcement request (if NOT in draft context)
    if (!isPollDraftContext && !isAnnouncementDraftContext && isAnnouncementRequest(textRaw)) {
      console.log(`[Twilio SMS] Detected announcement request from ${phoneNumber}`)
      
      // Extract announcement details
      const details = await extractAnnouncementDetails(body)
      console.log(`[Twilio SMS] Extracted details:`, details)
      
      // Check for quoted text - preserve verbatim
      const quoteMatch = body.match(/"([^"]+)"/)
      let announcementContent = details.content || ''
      if (quoteMatch) {
        announcementContent = quoteMatch[1] // Use exact quoted text
      }
      
      // If no content extracted, ask what they want to say
      if (!announcementContent || announcementContent.trim().length === 0) {
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>what would you like the announcement to say?</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
      
      // Generate draft (will preserve quoted text if provided)
      const draft = await generateAnnouncementDraft({ ...details, content: announcementContent })
      console.log(`[Twilio SMS] Generated draft: "${draft}"`)
      
      // Save draft
      const spaceIds = await getWorkspaceIds()
      const draftId = await saveDraft(phoneNumber, {
        content: draft,
        tone: details.tone,
        scheduledFor: details.scheduledFor ? new Date(details.scheduledFor) : undefined,
        targetAudience: details.targetAudience,
        workspaceId: spaceIds[0]
      }, spaceIds[0])
      
      const response = details.scheduledFor
        ? `okay here's what the announcement will say:\n\n${draft}\n\nscheduled for ${new Date(details.scheduledFor).toLocaleString()}. reply to edit or "send now" to send immediately`
        : `okay here's what the announcement will say:\n\n${draft}\n\nreply "send it" to broadcast or reply to edit the message`
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // Draft tone modifications (only if in draft context, not a query)
    if (isDraftModification(body) && (activeDraft || activePollDraft) && !looksLikeQuery) {
      console.log(`[Twilio SMS] Modifying draft tone for ${phoneNumber}`)
      
      if (activeDraft) {
        // Determine tone modification
        let newTone = activeDraft.tone || 'casual'
        if (body.toLowerCase().includes('meaner')) newTone = 'mean'
        if (body.toLowerCase().includes('nicer') || body.toLowerCase().includes('calmer')) newTone = 'casual'
        if (body.toLowerCase().includes('urgent')) newTone = 'urgent'
        
        // Regenerate draft with new tone
        const newDraft = await generateAnnouncementDraft(
          { content: activeDraft.content, tone: newTone },
          activeDraft.content
        )
        
        // Update draft
        await saveDraft(phoneNumber, {
          id: activeDraft.id,
          content: newDraft,
          tone: newTone,
          scheduledFor: activeDraft.scheduledFor,
          targetAudience: activeDraft.targetAudience,
          workspaceId: activeDraft.workspaceId
        }, activeDraft.workspaceId!)
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>updated:\n\n${newDraft}\n\nreply "send it" to broadcast</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else if (activePollDraft) {
        // Poll draft tone modification
        let newTone = 'casual'
        if (body.toLowerCase().includes('meaner')) newTone = 'urgent'
        if (body.toLowerCase().includes('nicer') || body.toLowerCase().includes('calmer')) newTone = 'casual'
        if (body.toLowerCase().includes('urgent')) newTone = 'urgent'
        
        const newQuestion = await generatePollQuestion(
          { question: activePollDraft.question, tone: newTone },
          activePollDraft.question
        )
        
        const spaceIds = await getWorkspaceIds()
        await savePollDraft(phoneNumber, {
          id: activePollDraft.id,
          question: newQuestion,
          options: activePollDraft.options,
          tone: newTone,
          workspaceId: spaceIds[0]
        }, spaceIds[0])
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>updated:\n\n${newQuestion}\n\nreply "send it" to send</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    }
    
    // Check if user wants to send the draft (activePollDraft already fetched above)
    if (command === 'SEND IT' || command === 'SEND NOW') {
      // Get announcement draft
      const activeDraft = await getActiveDraft(phoneNumber)
      
      // Determine which is more recent based on updated_at timestamp
      let shouldSendPoll = false
      if (activePollDraft && activeDraft) {
        // Both exist - compare timestamps
        const pollTime = new Date(activePollDraft.updatedAt || activePollDraft.createdAt || 0).getTime()
        const announcementTime = new Date(activeDraft.scheduledFor || activeDraft.updatedAt || 0).getTime()
        shouldSendPoll = pollTime > announcementTime
        console.log(`[Twilio SMS] Both drafts exist - poll: ${pollTime}, announcement: ${announcementTime}, sending: ${shouldSendPoll ? 'poll' : 'announcement'}`)
      } else if (activePollDraft) {
        shouldSendPoll = true
      }
      
      if (shouldSendPoll && activePollDraft && activePollDraft.id) {
        console.log(`[Twilio SMS] Sending poll ${activePollDraft.id}`)
        
        // Get Twilio client
        const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
        
        // Send poll
        const { sentCount, airtableLink } = await sendPoll(activePollDraft.id, twilioClient)
        
        const linkText = airtableLink ? `\n\nview results: ${airtableLink}` : ''
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>sent poll to ${sentCount} people 📊${linkText}</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else if (activeDraft && activeDraft.id) {
        console.log(`[Twilio SMS] Sending announcement ${activeDraft.id}`)
        
        // Get Twilio client
        const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
        
        // Send announcement
        const sentCount = await sendAnnouncement(activeDraft.id, twilioClient)
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>sent to ${sentCount} people 📢</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else {
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>no draft found. create an announcement or poll first</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    }
    
    // ============ POLL WORKFLOW ============
    
    // Check if user is providing poll question content (after being asked)
    // Look for a pending poll draft with empty/pending question
    // Note: activePollDraft already fetched above
    const pendingPollDraft = activePollDraft
    const isPendingPollQuestion = pendingPollDraft && 
      (!pendingPollDraft.question || pendingPollDraft.question.trim().length === 0 || 
       pendingPollDraft.question === 'pending')
    
    if (isPendingPollQuestion && !isPollRequest(body) && !isAnnouncementRequest(body)) {
      // User is providing the poll question content
      console.log(`[Twilio SMS] User providing poll question: "${body}"`)
      
      // Generate conversational poll question from their input
      const pollQuestion = await generatePollQuestion({ question: body })
      console.log(`[Twilio SMS] Generated poll question: "${pollQuestion}"`)
      
      // Update draft with question
      const spaceIds = await getWorkspaceIds()
      await savePollDraft(phoneNumber, {
        id: pendingPollDraft.id,
        question: pollQuestion,
        options: pendingPollDraft.options || ['Yes', 'No', 'Maybe'],
        workspaceId: pendingPollDraft.workspaceId
      }, spaceIds[0])
      
      const response = `okay here's what the poll will say:\n\n${pollQuestion}\n\nreply "send it" to send or reply to edit the message`
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // Check if this is a poll request
    if (isPollRequest(body)) {
      console.log(`[Twilio SMS] Detected poll request from ${phoneNumber}`)
      
      // Extract poll details
      const details = await extractPollDetails(body)
      console.log(`[Twilio SMS] Extracted poll details:`, details)
      
      // If no question extracted, create a pending draft and ask
      if (!details.question || details.question.trim().length === 0) {
        // Create a pending poll draft
        const spaceIds = await getWorkspaceIds()
        await savePollDraft(phoneNumber, {
          question: 'pending', // Mark as pending
          options: ['Yes', 'No', 'Maybe'],
          workspaceId: spaceIds[0]
        }, spaceIds[0])
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>what would you like to ask in the poll?</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
      
      // Generate conversational poll question
      const pollQuestion = await generatePollQuestion(details)
      console.log(`[Twilio SMS] Generated poll question: "${pollQuestion}"`)
      
      // Save draft
      const spaceIds = await getWorkspaceIds()
      const draftId = await savePollDraft(phoneNumber, {
        question: pollQuestion,
        options: details.options || ['Yes', 'No', 'Maybe'],
        tone: details.tone,
        workspaceId: spaceIds[0]
      }, spaceIds[0])
      
      const response = `okay here's what the poll will say:\n\n${pollQuestion}\n\nreply "send it" to send or reply to edit the message`
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // Poll draft editing is now handled in PRIORITY 1 above (context-aware routing)

    // Check if user is in sms_optin table to determine if they're truly new
    // Only send welcome if they're NOT in the table at all (first time ever)
    // Use optInDataAll which doesn't filter by opted_out
    const isTrulyNewUser = !optInDataAll
    let sassyWelcome = ''
    
    // Only show welcome for users who have NEVER opted in before (completely new phone number)
    if (isTrulyNewUser) {
      console.log(`[Twilio SMS] Brand new user ${phoneNumber}, asking for name first`)
      
      // Auto-opt in the user with needs_name status
      const { error: insertError } = await supabase
        .from('sms_optin')
        .insert({
          phone: phoneNumber,
          name: null, // Name is nullable - we'll collect it later
          method: 'sms_keyword',
          keyword: 'SEP',
          opted_out: false,
          needs_name: true,  // Flag to track that we need their name
          consent_timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      
      // If insert failed due to constraint (user already exists), don't send welcome
      if (insertError && insertError.code === '23505') {
        console.log(`[Twilio SMS] User ${phoneNumber} already in database, skipping welcome`)
        return new NextResponse(
          '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Response></Response>',
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else if (insertError) {
        console.error(`[Twilio SMS] Error inserting optin:`, insertError)
        
        // If insert failed for any reason (NOT duplicate key), check if user exists now
        // This handles race conditions where user was inserted between our check and insert
        const { data: existingUser } = await supabase
          .from('sms_optin')
          .select('*')
          .eq('phone', phoneNumber)
          .maybeSingle()
        
        if (existingUser) {
          // User exists (maybe from a race condition) - check if they need a name
          if (existingUser.needs_name) {
            // They need a name - fall through to name collection logic below
            console.log(`[Twilio SMS] User ${phoneNumber} exists but needs name, continuing to name collection`)
            // Don't return here - let it fall through to the needs_name check below
          } else {
            // They're fully set up - skip welcome and continue to normal message handling
            console.log(`[Twilio SMS] User ${phoneNumber} exists and is set up, skipping welcome`)
            // Break out of this block and continue normal flow (don't return)
          }
        } else {
          // Insert failed and user doesn't exist - this is likely the NOT NULL constraint
          // If name column is still NOT NULL, this will fail
          // Once migration runs to make name nullable, this should work
          console.error(`[Twilio SMS] Failed to insert optin - user doesn't exist. Error:`, insertError.message)
          console.error(`[Twilio SMS] This may be due to name NOT NULL constraint - run migration to make name nullable`)
          // Still ask for name - once migration is run, this will work
        }
      }

      // Only ask for name if insert succeeded OR if we're not continuing to normal flow
      // If user exists and is set up, we already logged and will continue below
      const shouldAskForName = !insertError || (insertError && insertError.code !== '23505')
      
      if (shouldAskForName) {
        // Ask for their name immediately
        return new NextResponse(
          '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Response><Message>hey! what\'s your name? (just reply with your first name)</Message></Response>',
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
      // If we get here, user exists and is set up - continue to normal message handling below
    }
    
    // Check if existing user needs to provide their name
    if (optInDataAll && optInDataAll.needs_name) {
      console.log(`[Twilio SMS] User ${phoneNumber} needs to provide name`)
      
      // Check if this message looks like a name
      const lowerMsg = body.toLowerCase().trim()
      const looksLikeName = body.trim().length > 1 && body.trim().length < 30 && 
        !lowerMsg.startsWith('i want') &&
        !lowerMsg.startsWith('create') &&
        !lowerMsg.startsWith('make') &&
        !lowerMsg.includes('when is') &&
        !lowerMsg.includes('what is')
      
      if (looksLikeName) {
        // Save the name
        await supabase
          .from('sms_optin')
          .update({ 
            name: body.trim(),
            needs_name: false 
          })
          .eq('phone', phoneNumber)
        
        // Also save to poll responses
        await updateNameEverywhere(from, body.trim())
        
        // Send welcome message
        const sassyMessages = [
          `hey ${body.trim()}! i'm enclave - ask me anything about your docs, events, or resources and i'll find it`,
          `what's up ${body.trim()}! i can search through all your connected resources. what do you need?`,
          `nice to meet you ${body.trim()}! i can help you search across your documents, calendar, and more`,
          `yo ${body.trim()}! you're all set up. just ask me questions about your resources and i'll find what you need`
        ]
        return new NextResponse(
          '<?xml version="1.0" encoding="UTF-8"?>' +
          `<Response><Message>${sassyMessages[Math.floor(Math.random() * sassyMessages.length)]}</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else {
        // Doesn't look like a name, ask again
        return new NextResponse(
          '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Response><Message>what\'s your name? (just reply with your first name)</Message></Response>',
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    }

    // Check if user has an active query session
    let { data: activeSession } = await supabase
      .from('sms_query_session')
      .select('*')
      .eq('phone_number', phoneNumber)
      .eq('status', 'active')
      .single()

    if (!activeSession) {
      // No active session - auto-create one and continue
      console.log(`[Twilio SMS] No active session for ${phoneNumber}, creating one`)
      await supabase
        .from('sms_query_session')
        .upsert({
          phone_number: phoneNumber,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      
      // Re-check to confirm session was created
      const { data: newSession } = await supabase
        .from('sms_query_session')
        .select('*')
        .eq('phone_number', phoneNumber)
        .eq('status', 'active')
        .single()
      
      activeSession = newSession
    }

    // This is a query - execute search
    const query = body?.trim()

    if (!query || query.length < 3) {
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Message>Please provide a longer search query (at least 3 characters).</Message></Response>',
        { 
          headers: { 'Content-Type': 'application/xml' }
        }
      )
    }

    // For SMS queries, restrict to UCLA SEP workspace ONLY
    // Search for workspace with "SEP" in the name (should match "UCLA SEP" or any workspace containing "SEP")
    const { data: sepSpaces } = await supabase
      .from('space')
      .select('id, name')
      .ilike('name', '%SEP%')

    const spaceIds: string[] = []
    
    if (sepSpaces && sepSpaces.length > 0) {
      for (const space of sepSpaces) {
        spaceIds.push(space.id)
      }
      console.log(`[Twilio SMS] Found ${sepSpaces.length} SEP workspace(s):`, sepSpaces.map(s => ({ id: s.id, name: s.name })))
    } else {
      console.error('[Twilio SMS] No SEP workspace found, defaulting to empty search')
    }

    console.log(`[Twilio SMS] Searching across ${spaceIds.length} workspaces for: "${query}"`)
    
    // Use the conversation history we already fetched earlier
    console.log(`[Twilio SMS] Found ${recentMessages?.length || 0} previous messages in conversation`)
    
    // Build conversation context for the AI
    let conversationContext = ''
    if (recentMessages && recentMessages.length > 0) {
      conversationContext = recentMessages
        .reverse() // Show in chronological order
        .map((msg: any) => `User: ${msg.user_message}\nBot: ${msg.bot_response}`)
        .join('\n\n') + '\n\nCurrent query:\n'
      console.log(`[Twilio SMS] Conversation context: ${conversationContext.substring(0, 100)}...`)
    }

    // Early classification short-circuit: abuse/smalltalk/enclave concise
    const early = earlyClassify(query, contextMessages)
    const profanity = detectProfanity(query)
    const insultTargets = guessInsultTarget(query)
    const toneDecision = decideTone({ smalltalk: early.isSmalltalk ? 1 : 0, toxicity: profanity ? 0.6 : 0, hasQuery: true, insultTargets })

    // Handle "is this jarvis" / "are you jarvis" / "what is enclave" questions (after name detection check)
    const isBotNameQ = /(is\s+this\s+jarvis|are\s+you\s+jarvis|is\s+this\s+enclave|are\s+you\s+enclave)/i.test(query)
    if (isBotNameQ) {
      // Confirm Jarvis identity - Jarvis is the bot powered by Enclave platform
      const botNameMsg = "yeah, i'm jarvis — the ai assistant powered by enclave. built by saathvik and the inquiyr team. i can search your org's docs, events, and send polls/announcements via sms."
      await supabase.from('sms_conversation_history').insert({ phone_number: phoneNumber, user_message: query, bot_response: botNameMsg })
      return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${botNameMsg}</Message></Response>`, { headers: { 'Content-Type': 'application/xml' } })
    }

    // Check for unsupported action requests (gcal invites, calendar sync, etc.)
    const routeCheck = classifyIntent(query, contextMessages)
    if (routeCheck.intent === 'action_request' && routeCheck.flags.unsupportedAction) {
      const unsupportedMsg = "can't do that yet — i can search docs/events and send polls/announcements. i'll let the devs know you want calendar invites!"
      await supabase.from('sms_conversation_history').insert({ phone_number: phoneNumber, user_message: query, bot_response: unsupportedMsg })
      return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${unsupportedMsg}</Message></Response>`, { headers: { 'Content-Type': 'application/xml' } })
    }

    if (toneDecision.policy === 'boundary' || early.isAbusive) {
      const msg = "✋ Not cool. Ask a question or text 'help'."
      const msgs = splitLongMessage(msg, 1600)
      if (msgs.length === 1) {
        return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${msgs[0]}</Message></Response>`, { headers: { 'Content-Type': 'application/xml' } })
      }
      const messageXml = msgs.map(m => `  <Message>${m}</Message>`).join('\n')
      return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response>\n${messageXml}\n</Response>`, { headers: { 'Content-Type': 'application/xml' } })
    }
    if (early.isSmalltalk) {
      const variants = [
        "what's the objective, bro? ask about events or docs",
        "ship it—what do you need: date, location, or who?",
        "pitch it in one line and i'll fetch the facts",
        "founder energy only—what's the KPI you want?",
        "speed run time: ask me when/where/who and i'll deliver"
      ]
      // 'more' expansion and confused feedback
      if (early.isMoreRequest) {
        const lastUser = recentMessages[0]?.user_message || ''
        const lastIntent = classifyIntent(lastUser, contextMessages).intent
        if (lastIntent === 'enclave_help') {
          const resp = await enclaveConciseAnswer(lastUser)
          return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${resp}</Message></Response>`, { headers: { 'Content-Type': 'application/xml' } })
        }
        const moreMsg = 'say what you want more of — what/when/where?'
        return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${moreMsg}</Message></Response>`, { headers: { 'Content-Type': 'application/xml' } })
      }
      if (early.isConfusedFeedback) {
        const clar = "got you — what didn’t make sense? want me to explain what/when/where?"
        return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${clar}</Message></Response>`, { headers: { 'Content-Type': 'application/xml' } })
      }
      const msg = ((toneDecision.prefix || '') + variants[Math.floor(Math.random() * variants.length)])
      return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${msg}</Message></Response>`, { headers: { 'Content-Type': 'application/xml' } })
    }
    if (early.intent === 'enclave_help') {
      const resp = await enclaveConciseAnswer(query)
      const msg = resp
      await supabase.from('sms_conversation_history').insert({ phone_number: phoneNumber, user_message: query, bot_response: msg })
      return new NextResponse(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${msg}</Message></Response>`, { headers: { 'Content-Type': 'application/xml' } })
    }

    // Execute search or use new router+retriever combiner
    const route = classifyIntent(query, contextMessages)
    const contentItems = await retrieveContent(query, spaceIds)
    const convoItems = await retrieveConvo(phoneNumber)
    const enclaveItems = await retrieveEnclave(query)
    const actionItems = await retrieveAction(phoneE164)
    const decision = combine({ intent: route.intent, content: contentItems as any, convo: convoItems as any, enclave: enclaveItems as any, action: actionItems as any })
    if (decision.type === 'answer' && decision.confidence >= 0.5) {
      const finalMsg = ((toneDecision.prefix || '') + decision.message)
      await supabase.from('sms_conversation_history').insert({ phone_number: phoneNumber, user_message: query, bot_response: finalMsg })
      const msgs = splitLongMessage(finalMsg, 1600)
      if (msgs.length === 1) {
        return new NextResponse(
          `<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${msgs[0]}</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
      const messageXml = msgs.map(m => `  <Message>${m}</Message>`).join('\n')
      return new NextResponse(
        `<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response>\n${messageXml}\n</Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }

    // Fallback to existing planner/search flows
    // Execute search
    const allResults = []
    for (const spaceId of spaceIds) {
      const results = await searchResourcesHybrid(
        query,
        spaceId,
        {},
        { limit: 5, offset: 0 },
        undefined // No specific userId for SMS searches
      )
      allResults.push(...results)
    }

    // Deduplicate results by ID
    const uniqueResultsMap = new Map()
    for (const result of allResults) {
      if (!uniqueResultsMap.has(result.id)) {
        uniqueResultsMap.set(result.id, result)
      }
    }
    const dedupedResults = Array.from(uniqueResultsMap.values())
      .sort((a, b) => (b.score || b.rank || 0) - (a.score || a.rank || 0))
      .slice(0, 3)

    console.log(`[Twilio SMS] Found ${dedupedResults.length} unique results`)

    // ========================================================================
    // NEW PLANNER-BASED FLOW (if enabled)
    // ========================================================================
    if (USE_PLANNER) {
      console.log(`[Twilio SMS] Using planner-based flow`)
      
      try {
        // Create query plan (spaceId doesn't matter for planning, just for tool execution)
        const plan = await planQuery(query, spaceIds[0])
        console.log(`[Twilio SMS] Plan intent: ${plan.intent}, confidence: ${plan.confidence}`)
        
        // Execute plan to try knowledge graph first
        let toolResults = await executePlan(plan, spaceIds[0])
        
        // If knowledge graph found nothing, use our cross-workspace results
        const hasGoodKnowledgeResult = toolResults.some(r => r.success && (r.confidence || 0) > 0.7)
        
        if (!hasGoodKnowledgeResult && dedupedResults.length > 0) {
          console.log(`[Twilio SMS] Knowledge graph failed, using cross-workspace doc search results (${dedupedResults.length} results)`)
          toolResults = [{
            tool: 'search_docs',
            success: true,
            data: { results: dedupedResults },
            confidence: 0.8
          }]
        }
        
        console.log(`[Twilio SMS] Executed ${toolResults.length} tools`)
        
        // Compose response
        const composed = await composeResponse(query, plan, toolResults)
        console.log(`[Twilio SMS] Composed response, confidence: ${composed.confidence}`)
        
        // Skip AI summarization for chat intents - they should be casual responses
        let finalText = composed.text
        
        // Only do AI summarization for content queries, not chat
        if (plan.intent !== 'chat' && toolResults.length > 0 && toolResults[0].data?.results) {
          // Get ALL results, not just the top one
          const allResults = toolResults[0].data.results
          console.log(`[Twilio SMS] Processing ${allResults.length} results for AI summarization`)
          
          // Try each result in order until we find a good answer
          for (const result of allResults) {
            // Handle short results differently - they might be complete answers (like "Wednesdays at 7 PM at SAC")
            if (!result.body || result.body.length < 10) {
              console.log(`[Twilio SMS] Skipping "${result.title}" - no body content`)
              continue
            }
            
            // For very short results (< 100 chars), just use the title + body as the context
            // For longer results, chunk and summarize
            const chunks: string[] = []
            const chunkSize = 1500
            
            if (result.body.length <= 100) {
              // Very short - use title + body as single chunk
              chunks.push(`${result.title}\n${result.body}`)
            } else if (result.body.length <= chunkSize) {
              // Medium length - use body as-is
              chunks.push(result.body)
            } else {
              // Long - chunk it
              for (let i = 0; i < result.body.length; i += chunkSize - 200) {
                chunks.push(result.body.substring(i, i + chunkSize))
              }
            }
            
            console.log(`[Twilio SMS] Trying "${result.title}" with ${chunks.length} chunks (body length: ${result.body?.length || 0})`)
            
            let foundGoodAnswer = false
            
            // Try each chunk
            for (let i = 0; i < chunks.length; i++) {
              // Combine conversation context with document content
              const context = conversationContext 
                ? `${conversationContext}Title: ${result.title}\nContent: ${chunks[i]}`
                : `Title: ${result.title}\nContent: ${chunks[i]}`
              
              try {
                const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
                const aiRes = await fetch(aiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    query,
                    context,
                    type: 'summary'
                  })
                })
                
                if (aiRes.ok) {
                  const aiData = await aiRes.json()
                  const response = aiData.response || ''
                  
                  const lowerResponse = response.toLowerCase()
                  const noInfoPatterns = ['no information', 'not found', 'does not contain', 'cannot provide']
                  const hasNoInfo = noInfoPatterns.some(p => lowerResponse.includes(p))
                  
                  if (!hasNoInfo && response.length > 20) {
                    finalText = response
                    foundGoodAnswer = true
                    console.log(`[Twilio SMS] ✓ Found answer in "${result.title}" chunk ${i + 1}/${chunks.length}`)
                    break
                  }
                }
              } catch (err) {
                console.error(`[Twilio SMS] AI call failed for "${result.title}" chunk ${i + 1}:`, err)
              }
            }
            
            // If we found a good answer, stop trying more results
            if (foundGoodAnswer) {
              break
            }
          }
          
          // If no AI summary found across all results, use the top result's body
          if (!finalText || finalText === composed.text) {
            finalText = allResults[0]?.body || allResults[0]?.title || composed.text
          }
        }
        
        // Store query answer for later
        queryAnswer = finalText || composed.text
        
        // Format response
        let responseMessage = ''
        
        // Add welcome for new users
        if (isTrulyNewUser && sassyWelcome) {
          responseMessage = `${sassyWelcome}\n\n`
        }
        
        // Add main response
        responseMessage += finalText
        
        // Check for abandoned drafts to mention (but NOT if actively creating a poll/question)
        let draftFollowUp = ''
        if (activePollDraft && !isPollDraftContext && !isPollQuestionInputContext) {
          draftFollowUp = `\n\nbtw you have a poll draft ready: "${activePollDraft.question}" - reply "send it" to send`
        } else if (activeDraft && !isAnnouncementDraftContext) {
          draftFollowUp = `\n\nbtw you have an announcement draft ready - reply "send it" to send`
        }
        
        // Add poll follow-up if user ignored a poll
        if (pendingPollFollowUp) {
          responseMessage += `\n\n${pendingPollFollowUp}`
        }
        
        // Add draft follow-up
        if (draftFollowUp) {
          responseMessage += draftFollowUp
        }
        
        // Save conversation history
        await supabase
          .from('sms_conversation_history')
          .insert({
            phone_number: phoneNumber,
            user_message: query,
            bot_response: responseMessage
          })
        
        // Split and send
        const messages = splitLongMessage(responseMessage, 1600)
        
        if (messages.length === 1) {
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${messages[0]}</Message>
</Response>`,
            { headers: { 'Content-Type': 'application/xml' } }
          )
        } else {
          const messageXml = messages.map(msg => `  <Message>${msg}</Message>`).join('\n')
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${messageXml}
</Response>`,
            { headers: { 'Content-Type': 'application/xml' } }
          )
        }
      } catch (error) {
        console.error(`[Twilio SMS] Planner error, falling back to old flow:`, error)
        // Fall through to old flow
      }
    }

    // ========================================================================
    // OLD FLOW (fallback or if planner disabled)
    // ========================================================================
    // Generate natural summary from results - use CHUNKING to search through entire documents
    let summary = ''
    if (dedupedResults.length > 0) {
      console.log(`[Twilio SMS] Processing ${dedupedResults.length} results with chunking strategy`)
      
      // Try each result, chunking large documents
      let foundAnswer = false
      
      for (const result of dedupedResults.slice(0, 3)) {
        if (foundAnswer) break
        
        const body = result.body || ''
        if (!body) {
          console.log(`[Twilio SMS] Skipping "${result.title}" - no body content`)
          continue
        }
        
        // Split document into 1500-char chunks with overlap
        const chunkSize = 1500
        const chunks: string[] = []
        
        if (body.length <= chunkSize) {
          chunks.push(body)
        } else {
          // Create overlapping chunks to avoid splitting relevant content
          for (let i = 0; i < body.length; i += chunkSize - 200) { // 200 char overlap
            chunks.push(body.substring(i, i + chunkSize))
          }
        }
        
        console.log(`[Twilio SMS] Document "${result.title}" (${body.length} chars) split into ${chunks.length} chunks`)
        
        // Try each chunk until we find an answer
        for (let i = 0; i < chunks.length; i++) {
          if (foundAnswer) break
          
          const context = `Title: ${result.title}\nContent: ${chunks[i]}`
          
          try {
            const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
            
            const aiRes = await fetch(aiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query,
                context,
                type: 'summary'
              })
            })
            
            if (aiRes.ok) {
              const aiData = await aiRes.json()
              const response = aiData.response || ''
              
              // Check if AI found information (not a "no information" response)
              const lowerResponse = response.toLowerCase()
              const noInfoPatterns = [
                'no information',
                'not found',
                'does not contain',
                'does not provide',
                'does not include',
                'no info',
                'could not find',
                'unable to find',
                'cannot provide'
              ]
              
              const hasNoInfo = noInfoPatterns.some(pattern => lowerResponse.includes(pattern))
              
              if (!hasNoInfo && response.length > 20) {
                summary = response
                foundAnswer = true
                console.log(`[Twilio SMS] ✓ Found answer in chunk ${i + 1}/${chunks.length} of "${result.title}"`)
                console.log(`[Twilio SMS] Answer preview: ${response.substring(0, 100)}...`)
                break
              } else {
                console.log(`[Twilio SMS] ✗ Chunk ${i + 1}/${chunks.length} of "${result.title}" - no relevant info (hasNoInfo: ${hasNoInfo})`)
              }
            } else {
              console.error(`[Twilio SMS] AI API returned ${aiRes.status}`)
            }
          } catch (err) {
            console.error(`[Twilio SMS] AI call failed for chunk ${i + 1}:`, err)
          }
        }
        
        // After trying all chunks of this document, log result
        if (!foundAnswer) {
          console.log(`[Twilio SMS] No answer found in any chunk of "${result.title}", moving to next document`)
        }
      }
      
      // Fallback if no answer found
      if (!summary) {
        const topResult = dedupedResults[0]
        summary = topResult.body?.substring(0, 400) || topResult.title
        console.log('[Twilio SMS] Using fallback summary from top result')
      }
      
      console.log('[Twilio SMS] Final summary:', summary.substring(0, 100))
    }

    // Format response for SMS
    let responseMessage = ''
    
    // Add welcome ONLY for brand new users who just opted in (isTrulyNewUser = true and sassyWelcome was set)
    // This ensures welcome is ONLY sent on the FIRST message ever from a phone number
    if (isTrulyNewUser && sassyWelcome) {
      responseMessage = `${sassyWelcome}\n\n`
    }
    
    // If this was a query that was answered, add follow-ups
    if (queryAnswer || summary) {
      // Already handled in planner flow above, but for old flow we need to do it here
    }
    
    // Classify the query using LLM, but also check similarity scores
    // If results have low similarity (< 0.7), they're probably not relevant
    const hasGoodResults = dedupedResults.length > 0 && dedupedResults.some(r => (r.score || r.rank || 0) > 0.7)
    const queryType = await classifyQuery(query, hasGoodResults ? dedupedResults.length : 0)
    console.log(`[Twilio SMS] Query classified as: ${queryType}, has good results: ${hasGoodResults}`)
    
    if (!hasGoodResults || queryType === 'chat' || queryType === 'enclave') {
      // No results OR classified as chat/enclave - check category
      
      if (queryType === 'enclave') {
        let enclaveInfo = ''
        const lowerQuery = query.toLowerCase()
        if (lowerQuery.includes('terrible') || lowerQuery.includes('sucks')) {
          enclaveInfo = `Ouch! We're working on it. Enclave helps you search all your resources via SMS or web.\n\nQuestions? Email try.inquiyr@gmail.com`
        } else {
          enclaveInfo = `Enclave is your AI-powered knowledge base.\n\nCURRENT CAPABILITIES:\nSearch across docs, Google Docs, Calendar events\nHybrid search (semantic + keyword)\nWorkspace-based organization\nMultiple sources: uploads, Google, Calendar, Slack\n\nFUTURE:\nMulti-modal search (images, videos)\nTeam collaboration features\nAdvanced analytics\nEnterprise integrations\n\nText your question to search!`
        }
        responseMessage += enclaveInfo
      } else {
        // Not about content or Enclave - snarky AI response
        // Call the AI API for a snarky response
        try {
          const aiRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              context: 'No matching content found.',
              type: 'general'
            })
          })
          
          if (aiRes.ok) {
            const aiData = await aiRes.json()
            responseMessage += aiData.response || "I don't have any info on that. Try asking about something in your resources."
          } else {
            responseMessage += "I don't have any info on that. Try asking about something in your resources."
          }
        } catch (err) {
          responseMessage += "I don't have any info on that. Try asking about something in your resources."
        }
      }
    } else if (queryType === 'content' && hasGoodResults) {
      // We have good results and it's classified as content - send the natural summary
      if (summary && summary.length > 0) {
        responseMessage += summary
      } else {
        // Fallback if no summary generated
        const topResult = dedupedResults[0]
        responseMessage += topResult.body || topResult.title
      }
    }
    // If queryType is 'chat' but no results, the chat handler above already took care of it
    
    // Add follow-ups for queries (if this was a query)
    if (looksLikeQuery && (summary || queryAnswer)) {
      // Check for abandoned drafts (but NOT if actively creating)
      if (activePollDraft && !isPollDraftContext && !isPollQuestionInputContext) {
        responseMessage += `\n\nbtw you have a poll draft ready: "${activePollDraft.question}" - reply "send it" to send`
      } else if (activeDraft && !isAnnouncementDraftContext) {
        responseMessage += `\n\nbtw you have an announcement draft ready - reply "send it" to send`
      }
      
      // Check for pending poll
      if (pendingPollFollowUp) {
        responseMessage += `\n\n${pendingPollFollowUp}`
      }
    }

    // Split long messages at sentence boundaries
    const messages = splitLongMessage(responseMessage, 1600)
    
    // Twilio supports multiple <Message> tags for multiple messages
    if (messages.length === 1) {
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${messages[0]}</Message>
</Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    } else {
      // Multiple messages
      const messagesXml = messages.map(msg => `<Message>${msg}</Message>`).join('\n  ')
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${messagesXml}
</Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }

  } catch (error) {
    console.error('[Twilio SMS] Error processing message:', error)
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response><Message>Error processing your request. Please try again later.</Message></Response>',
      { 
        headers: { 'Content-Type': 'application/xml' }
      }
    )
  }
}

