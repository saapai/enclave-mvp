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
  extractRawAnnouncementText,
  patchAnnouncementDraft
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
import { classifyConversationalContext } from '@/lib/nlp/conversationalContext'
import { routeAction } from '@/lib/nlp/actionRouter'
import { enclaveConciseAnswer } from '@/lib/enclave/answers'
import { smsTighten } from '@/lib/text/limits'
import { handleTurn, toTwiml } from '@/lib/orchestrator/handleTurn'
import { handleTurn as handleSessionTurn } from '@/lib/session/handler'
import { handleSMSMessage } from '@/lib/sms/unified-handler'
import { splitLongMessage } from '@/lib/text/limits'

// Feature flag: Enable new session-based state machine (takes highest priority)
const USE_SESSION_STATE_MACHINE = true

// Feature flag: Enable orchestrator-based flow
const USE_ORCHESTRATOR = true

// Feature flag: Enable new planner-based flow
const USE_PLANNER = true

const TWILIO_RATE_LIMIT_DELAY = 200
const MAX_MESSAGES_PER_BATCH = 5
const CONTENT_DEDUP_WINDOW_MS = 2000
const INFLIGHT_CONTENT: Map<string, number> = new Map()

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

    // ========================================================================
    // PRIORITY 0: Bot Identity Questions (BEFORE orchestrator)
    // ========================================================================
    const isBotIdentityQuestion = /(who'?s\s+this|who\s+are\s+you|who\s+is\s+this|what'?s\s+your\s+name|what\s+are\s+you)/i.test(body)
    if (isBotIdentityQuestion) {
      console.log(`[Bot Identity] Bot identity question detected: "${body}"`)
      // Check if user has a name
      const hasName = optInDataAll?.name && optInDataAll.name.trim().length > 0
      console.log(`[Bot Identity] User state: hasName=${hasName}, optInDataAll=${!!optInDataAll}, needs_name=${optInDataAll?.needs_name}`)
      
      let responseMessage: string
      if (hasName) {
        // User has name - just tell them who we are
        responseMessage = `hey ${optInDataAll.name}! i'm jarvis, powered by enclave. i can help you find info about events, docs, and more.`
        console.log(`[Bot Identity] User has name, responding with greeting`)
      } else {
        // User doesn't have name - intro + ask for name
        responseMessage = `hey! i'm jarvis, powered by enclave. i can help you find info about events, docs, and more. what's your name?`
        console.log(`[Bot Identity] User doesn't have name, asking for it`)
        
        // If they're not in the system yet, add them
        if (!optInDataAll) {
          console.log(`[Bot Identity] Adding new user to sms_optin`)
          const { error: insertError } = await supabase
            .from('sms_optin')
            .insert({
              phone: phoneNumber,
              name: null,
              method: 'sms_keyword',
              keyword: 'SEP',
              opted_out: false,
              needs_name: true,
              consent_timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
          
          if (insertError) {
            console.error(`[Bot Identity] Error inserting new user:`, JSON.stringify(insertError, null, 2))
          } else {
            console.log(`[Bot Identity] ✓ Added new user to sms_optin`)
          }
        } else if (!optInDataAll.needs_name) {
          // They exist but don't have needs_name set - set it
          console.log(`[Bot Identity] Setting needs_name=true for existing user`)
          const { error: updateError } = await supabase
            .from('sms_optin')
            .update({ needs_name: true })
            .eq('phone', phoneNumber)
          
          if (updateError) {
            console.error(`[Bot Identity] Error updating needs_name:`, JSON.stringify(updateError, null, 2))
          } else {
            console.log(`[Bot Identity] ✓ Set needs_name=true for existing user`)
          }
        }
        
        // Ensure user exists in Airtable
        const { ENV } = await import('@/lib/env')
        const { ensureAirtableUser } = await import('@/lib/airtable')
        
        if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
          console.log(`[Bot Identity] Ensuring Airtable user exists: phone=${from}`)
          try {
            const airtableResult = await ensureAirtableUser(
              ENV.AIRTABLE_BASE_ID,
              ENV.AIRTABLE_TABLE_NAME,
              from,
              undefined
            )
            
            if (airtableResult.ok) {
              console.log(`[Bot Identity] ✓ Airtable user ensured (created=${airtableResult.created}, id=${airtableResult.id || 'none'})`)
            } else {
              console.error(`[Bot Identity] ✗ Failed to ensure Airtable user: ${airtableResult.error}`)
            }
          } catch (err) {
            console.error(`[Bot Identity] ✗ Exception ensuring Airtable user:`, err)
          }
        }
      }
      
      // Save conversation history
      console.log(`[Bot Identity] Saving conversation history`)
      const { error: historyError } = await supabase.from('sms_conversation_history').insert({
        phone_number: phoneNumber,
        user_message: body,
        bot_response: responseMessage
      })
      
      if (historyError) {
        console.error(`[Bot Identity] ✗ Failed to save conversation history:`, JSON.stringify(historyError, null, 2))
      } else {
        console.log(`[Bot Identity] ✓ Saved conversation history`)
      }
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseMessage}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }

    // ========================================================================
    // PRIORITY 0.5: New User Welcome Flow (BEFORE orchestrator)
    // ========================================================================
    // Check if user is truly new (not in sms_optin at all) OR needs name
    const isTrulyNewUser = !optInDataAll
    const needsName = optInDataAll?.needs_name === true || (optInDataAll && (!optInDataAll.name || optInDataAll.name.trim().length === 0))
    
    console.log(`[Name Collection] Checking user: phone=${phoneNumber}, isTrulyNewUser=${isTrulyNewUser}, needsName=${needsName}`)
    if (optInDataAll) {
      console.log(`[Name Collection] optInDataAll: needs_name=${optInDataAll.needs_name}, name="${optInDataAll.name || 'null'}"`)
    }
    
    if (isTrulyNewUser) {
      console.log(`[Name Collection] Brand new user ${phoneNumber}, sending intro and asking for name`)
      
      // Auto-opt in the user with needs_name status
      const { error: insertError } = await supabase
        .from('sms_optin')
        .insert({
          phone: phoneNumber,
          name: null,
          method: 'sms_keyword',
          keyword: 'SEP',
          opted_out: false,
          needs_name: true,
          consent_timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      
      if (insertError) {
        if (insertError.code === '23505') {
          console.log(`[Name Collection] User ${phoneNumber} already exists in sms_optin (duplicate key)`)
        } else {
          console.error(`[Name Collection] Error inserting optin for ${phoneNumber}:`, JSON.stringify(insertError, null, 2))
        }
      } else {
        console.log(`[Name Collection] ✓ Successfully inserted new user ${phoneNumber} into sms_optin`)
      }
      
      // Create Airtable row for new user (even without name)
      const { ENV } = await import('@/lib/env')
      const { ensureAirtableUser } = await import('@/lib/airtable')
      
      console.log(`[Airtable Sync] Checking Airtable config: API_KEY=${!!ENV.AIRTABLE_API_KEY}, BASE_ID=${!!ENV.AIRTABLE_BASE_ID}, TABLE_NAME=${!!ENV.AIRTABLE_TABLE_NAME}`)
      
      if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
        console.log(`[Airtable Sync] Ensuring Airtable user exists: phone=${from}, base=${ENV.AIRTABLE_BASE_ID}, table=${ENV.AIRTABLE_TABLE_NAME}`)
        try {
          const airtableResult = await ensureAirtableUser(
            ENV.AIRTABLE_BASE_ID,
            ENV.AIRTABLE_TABLE_NAME,
            from, // Use full E.164 format from Twilio
            undefined // No name yet
          )
          
          console.log(`[Airtable Sync] Result: ok=${airtableResult.ok}, created=${airtableResult.created}, id=${airtableResult.id || 'none'}, error=${airtableResult.error || 'none'}`)
          
          if (airtableResult.ok) {
            if (airtableResult.created) {
              console.log(`[Airtable Sync] ✓ Created new Airtable row for new user ${phoneNumber} (record ID: ${airtableResult.id})`)
            } else {
              console.log(`[Airtable Sync] ✓ New user ${phoneNumber} already exists in Airtable (record ID: ${airtableResult.id})`)
            }
          } else {
            console.error(`[Airtable Sync] ✗ Failed to create Airtable row for new user ${phoneNumber}: ${airtableResult.error}`)
          }
        } catch (err) {
          console.error(`[Airtable Sync] ✗ Exception creating Airtable row for new user ${phoneNumber}:`, err)
          if (err instanceof Error) {
            console.error(`[Airtable Sync] Exception details: ${err.message}\n${err.stack}`)
          }
        }
      } else {
        console.warn(`[Airtable Sync] Skipping Airtable sync - missing config: API_KEY=${!!ENV.AIRTABLE_API_KEY}, BASE_ID=${!!ENV.AIRTABLE_BASE_ID}, TABLE_NAME=${!!ENV.AIRTABLE_TABLE_NAME}`)
      }
      
      // Send intro message asking for name
      const introMessage = `hey! i'm jarvis, powered by enclave. i can help you find info about events, docs, and more. what's your name?`
      
      // Save conversation history
      console.log(`[Conversation History] Saving conversation for new user ${phoneNumber}`)
      const { error: historyError } = await supabase.from('sms_conversation_history').insert({
        phone_number: phoneNumber,
        user_message: body,
        bot_response: introMessage
      })
      
      if (historyError) {
        console.error(`[Conversation History] ✗ Failed to save conversation for ${phoneNumber}:`, JSON.stringify(historyError, null, 2))
      } else {
        console.log(`[Conversation History] ✓ Saved conversation for new user ${phoneNumber}`)
      }
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${introMessage}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // Check if existing user needs to provide name (including those who slipped through)
    if (needsName) {
      console.log(`[Name Collection] User ${phoneNumber} needs to provide name`)
      
      // Ensure user exists in Airtable (create row if not exists, even without name)
      const { ENV } = await import('@/lib/env')
      const { ensureAirtableUser } = await import('@/lib/airtable')
      
      console.log(`[Airtable Sync] Checking Airtable config for existing user: API_KEY=${!!ENV.AIRTABLE_API_KEY}, BASE_ID=${!!ENV.AIRTABLE_BASE_ID}, TABLE_NAME=${!!ENV.AIRTABLE_TABLE_NAME}`)
      
      if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
        console.log(`[Airtable Sync] Ensuring Airtable user exists: phone=${from}, base=${ENV.AIRTABLE_BASE_ID}, table=${ENV.AIRTABLE_TABLE_NAME}`)
        try {
          const airtableResult = await ensureAirtableUser(
            ENV.AIRTABLE_BASE_ID,
            ENV.AIRTABLE_TABLE_NAME,
            from, // Use full E.164 format from Twilio
            undefined // No name yet
          )
          
          console.log(`[Airtable Sync] Result: ok=${airtableResult.ok}, created=${airtableResult.created}, id=${airtableResult.id || 'none'}, error=${airtableResult.error || 'none'}`)
          
          if (airtableResult.ok) {
            if (airtableResult.created) {
              console.log(`[Airtable Sync] ✓ Created new Airtable row for user ${phoneNumber} (record ID: ${airtableResult.id})`)
            } else {
              console.log(`[Airtable Sync] ✓ User ${phoneNumber} already exists in Airtable (record ID: ${airtableResult.id})`)
            }
          } else {
            console.error(`[Airtable Sync] ✗ Failed to ensure Airtable user ${phoneNumber}: ${airtableResult.error}`)
          }
        } catch (err) {
          console.error(`[Airtable Sync] ✗ Exception ensuring Airtable user ${phoneNumber}:`, err)
          if (err instanceof Error) {
            console.error(`[Airtable Sync] Exception details: ${err.message}\n${err.stack}`)
          }
        }
      } else {
        console.warn(`[Airtable Sync] Skipping Airtable sync - missing config: API_KEY=${!!ENV.AIRTABLE_API_KEY}, BASE_ID=${!!ENV.AIRTABLE_BASE_ID}, TABLE_NAME=${!!ENV.AIRTABLE_TABLE_NAME}`)
      }
      
      // Check if this message looks like a name declaration
      console.log(`[Name Collection] Checking if message looks like name: "${body}"`)
      const nameCheck = await isNameDeclaration(body)
      console.log(`[Name Collection] Name check result: isName=${nameCheck.isName}, name="${nameCheck.name || 'null'}"`)
      
      if (nameCheck.isName && nameCheck.name) {
        console.log(`[Name Collection] Detected name: "${nameCheck.name}" for user ${phoneNumber}`)
        
        // Check if this was a new user (needs_name was true) BEFORE updating
        const { data: userDataBefore } = await supabase
          .from('sms_optin')
          .select('needs_name')
          .eq('phone', phoneNumber)
          .maybeSingle()
        
        const wasNewUser = userDataBefore?.needs_name === true
        console.log(`[Name Collection] User state before update: wasNewUser=${wasNewUser}, needs_name=${userDataBefore?.needs_name}`)
        
        // Update sms_optin first to ensure needs_name is cleared
        // Use phoneNumber (already normalized) to match how the table stores it
        console.log(`[Name Collection] Updating sms_optin: phone=${phoneNumber}, name="${nameCheck.name}"`)
        const { error: updateError } = await supabase
          .from('sms_optin')
          .update({ 
            name: nameCheck.name,
            needs_name: false,
            updated_at: new Date().toISOString()
          })
          .eq('phone', phoneNumber)
        
        if (updateError) {
          console.error(`[Name Collection] ✗ Error updating sms_optin for ${phoneNumber}:`, JSON.stringify(updateError, null, 2))
        } else {
          console.log(`[Name Collection] ✓ Updated sms_optin: set name="${nameCheck.name}", needs_name=false for ${phoneNumber}`)
        }
        
        // Update name everywhere (Supabase poll responses + Airtable)
        console.log(`[Name Collection] Updating name everywhere: phone=${from}, name="${nameCheck.name}"`)
        await updateNameEverywhere(from, nameCheck.name)
        console.log(`[Name Collection] ✓ Completed updateNameEverywhere for ${phoneNumber}`)
        
        // If was new user, send setup complete message
        if (wasNewUser) {
          const setupMessage = `all set up! feel free to ask me any questions about sep`
          
          // Save conversation history
          console.log(`[Conversation History] Saving conversation for new user ${phoneNumber} (name provided)`)
          const { error: historyError } = await supabase.from('sms_conversation_history').insert({
            phone_number: phoneNumber,
            user_message: body,
            bot_response: setupMessage
          })
          
          if (historyError) {
            console.error(`[Conversation History] ✗ Failed to save conversation for ${phoneNumber}:`, JSON.stringify(historyError, null, 2))
          } else {
            console.log(`[Conversation History] ✓ Saved conversation for new user ${phoneNumber}`)
          }
          
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${setupMessage}</Message></Response>`,
            { headers: { 'Content-Type': 'application/xml' } }
          )
        } else {
          // Existing user updating name
          const confirmMsg = `got it! i'll call you ${nameCheck.name}.`
          
          // Save conversation history
          console.log(`[Conversation History] Saving conversation for existing user ${phoneNumber} (name updated)`)
          const { error: historyError } = await supabase.from('sms_conversation_history').insert({
            phone_number: phoneNumber,
            user_message: body,
            bot_response: confirmMsg
          })
          
          if (historyError) {
            console.error(`[Conversation History] ✗ Failed to save conversation for ${phoneNumber}:`, JSON.stringify(historyError, null, 2))
          } else {
            console.log(`[Conversation History] ✓ Saved conversation for existing user ${phoneNumber}`)
          }
          
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${confirmMsg}</Message></Response>`,
            { headers: { 'Content-Type': 'application/xml' } }
          )
        }
      } else {
        // Doesn't look like a name, proactively ask for it
        // Check if we've already asked recently (within last 5 minutes) to avoid spam
        console.log(`[Name Collection] Message doesn't look like name, checking if we should ask`)
        const { data: recentAsk, error: recentAskError } = await supabase
          .from('sms_conversation_history')
          .select('created_at')
          .eq('phone_number', phoneNumber)
          .ilike('bot_response', '%what\'s your name%')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (recentAskError) {
          console.error(`[Name Collection] Error checking recent ask:`, JSON.stringify(recentAskError, null, 2))
        }
        
        const shouldAsk = !recentAsk || 
          (new Date().getTime() - new Date(recentAsk.created_at).getTime() > 5 * 60 * 1000) // 5 minutes
        
        console.log(`[Name Collection] Should ask: ${shouldAsk}, recentAsk=${recentAsk ? recentAsk.created_at : 'none'}`)
        
        if (shouldAsk) {
          const askAgainMessage = `what's your name? (just reply with your first name)`
          
          // Save conversation history
          console.log(`[Conversation History] Saving conversation for user ${phoneNumber} (asking for name)`)
          const { error: historyError } = await supabase.from('sms_conversation_history').insert({
            phone_number: phoneNumber,
            user_message: body,
            bot_response: askAgainMessage
          })
          
          if (historyError) {
            console.error(`[Conversation History] ✗ Failed to save conversation for ${phoneNumber}:`, JSON.stringify(historyError, null, 2))
          } else {
            console.log(`[Conversation History] ✓ Saved conversation for user ${phoneNumber} (asked for name)`)
          }
          
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${askAgainMessage}</Message></Response>`,
            { headers: { 'Content-Type': 'application/xml' } }
          )
        }
        // If we asked recently, fall through to normal message handling
        console.log(`[Name Collection] Asked recently, falling through to normal message handling`)
      }
    }

    // ============ NAME DETECTION (HIGHEST PRIORITY) ============
    // Check if user is declaring their name - but NOT if it's a question about the bot's name
    const isBotNameQuestion = /(is\s+this\s+jarvis|are\s+you\s+jarvis|is\s+this\s+enclave|are\s+you\s+enclave)/i.test(body)
    if (!isBotNameQuestion) {
    const nameCheck = await isNameDeclaration(body)
    if (nameCheck.isName && nameCheck.name) {
      console.log(`[Twilio SMS] Name declared: ${nameCheck.name} for ${phoneNumber}`)
      
      // Check if this was a new user (needs_name was true) BEFORE updating
      const { data: userDataBefore } = await supabase
        .from('sms_optin')
        .select('needs_name')
        .eq('phone', phoneNumber)
        .maybeSingle()
      
      const wasNewUser = userDataBefore?.needs_name === true
      
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
      
      // If was new user, send setup complete message
      if (wasNewUser) {
        const setupMessage = `all set up! feel free to ask me any questions about sep`
        
        // Save conversation history
        await supabase.from('sms_conversation_history').insert({
          phone_number: phoneNumber,
          user_message: body,
          bot_response: setupMessage
        })
      
      return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${setupMessage}</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else {
        // Existing user updating name
        const confirmMsg = `got it! i'll call you ${nameCheck.name}.`
        
        // Save conversation history
        await supabase.from('sms_conversation_history').insert({
          phone_number: phoneNumber,
          user_message: body,
          bot_response: confirmMsg
        })
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${confirmMsg}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
      }
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
    // UNIFIED CONTEXT-AWARE HANDLER (Primary Path)
    // ========================================================================
    try {
      console.log(`[Twilio SMS] Calling unified handler for: ${body.substring(0, 50)}`)
      
      // Check intent first to determine if async processing is needed
      // We need to classify without processing to see if it's a content query
      const { classifyIntent, loadWeightedHistory } = await import('@/lib/sms/context-aware-classifier')
      const history = await loadWeightedHistory(phoneNumber, 15)
      const intent = await classifyIntent(body, history)
      
      // Only content_query needs async processing (simple_question and follow_up_query are fast)
      const needsAsyncProcessing = intent.type === 'content_query'
      
      if (needsAsyncProcessing) {
        const dedupeKey = `${from}:${body.trim().toLowerCase()}`
        const existing = INFLIGHT_CONTENT.get(dedupeKey)
        const now = Date.now()
        if (existing && now - existing < CONTENT_DEDUP_WINDOW_MS) {
          console.log(`[Twilio SMS] Duplicate content query detected within window (${dedupeKey}), returning ack only`)
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Looking that up...</Message></Response>`,
            { headers: { 'Content-Type': 'application/xml' } }
          )
        }
        INFLIGHT_CONTENT.set(dedupeKey, now)
        setTimeout(() => INFLIGHT_CONTENT.delete(dedupeKey), CONTENT_DEDUP_WINDOW_MS)
        
        // For content queries, return immediate acknowledgment and process asynchronously
        // This prevents Twilio timeout (10-15 second limit)
        const traceId = `sms_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        console.log(`[Twilio SMS] [${traceId}] Content query detected, processing asynchronously`)
        
        // Return immediate acknowledgment
        const ackResponse = new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Looking that up...</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
        
        // Process query asynchronously (don't await)
        console.log(`[Twilio SMS] [${traceId}] Starting async handler for content query: "${body.substring(0, 50)}"`)
        
      // WATCHDOG: 11.5s timeout to prevent silent hangs (Vercel Pro allows 60s)
      // System typically completes in 5-10s, so 11.5s leaves room for the pipeline (10s) to finish first
      let watchdogFired = false
      const watchdog = setTimeout(async () => {
        watchdogFired = true
        console.error(`[Twilio SMS] [${traceId}] WATCHDOG: content_query exceeded 11.5s, sending degraded reply`)
        try {
          await sendSms(from, "Still searching... this is taking longer than expected. I'll keep trying.", { retries: 1, retryDelay: 2000 })
          console.log(`[Twilio SMS] [${traceId}] Watchdog message sent`)
        } catch (err) {
          console.error(`[Twilio SMS] [${traceId}] Failed to send watchdog message:`, err)
        }
      }, 11500) // 11.5 second watchdog
        
      // Set a hard timeout before Vercel kills us (Pro = 60s)
      let timeoutFired = false
      const asyncTimeout = setTimeout(async () => {
        timeoutFired = true
        console.error(`[Twilio SMS] [${traceId}] Async handler timeout after 55s for query: "${body.substring(0, 50)}"`)
        if (!watchdogFired) {
          try {
            await sendSms(from, "Sorry, that query took too long. Please try a simpler question.", { retries: 1, retryDelay: 2000 })
            console.log(`[Twilio SMS] [${traceId}] Timeout message sent`)
          } catch (err) {
            console.error(`[Twilio SMS] [${traceId}] Failed to send timeout message:`, err)
          }
        }
      }, 55000) // 55 second timeout (5s buffer before Vercel's 60s limit)
        
        // Re-process the message asynchronously
        // Pass the already-classified intent to avoid redundant LLM call
        const handlerStartTime = Date.now()
        handleSMSMessage(phoneNumber, from, body, intent, history)
          .then(async (result) => {
            clearTimeout(watchdog)
            clearTimeout(asyncTimeout)
            const handlerDuration = Date.now() - handlerStartTime
            console.log(`[Twilio SMS] [${traceId}] Async handler completed successfully in ${handlerDuration}ms`)
            console.log(`[Twilio SMS] [${traceId}] Async handler returned: "${result?.response?.substring(0, 100) || 'NO RESPONSE'}..."`)
            
            // If watchdog or timeout already fired, don't send another message
            if (timeoutFired) {
              console.log(`[Twilio SMS] [${traceId}] Hard timeout already fired, skipping result send`)
              return
            }
            
            if (watchdogFired) {
              console.log(`[Twilio SMS] [${traceId}] Watchdog message already sent; delivering final result update`)
            }
            
            // Ensure we have a response
            if (!result || !result.response || result.response.trim().length === 0) {
              console.error('[Twilio SMS] Async handler returned empty response!', result)
              await sendSms(from, "Sorry, I couldn't find information about that.", { retries: 1, retryDelay: 2000 })
              return
            }
            
            // Save conversation history if needed
            if (result.shouldSaveHistory) {
              try {
                await supabase.from('sms_conversation_history').insert({
                  phone_number: phoneNumber,
                  user_message: body,
                  bot_response: result.response
                })
                console.log(`[Twilio SMS] Saved conversation history`)
              } catch (err) {
                console.error('[Twilio SMS] Failed to save conversation history:', err)
              }
            }
            
            // Split long messages
            const messages = splitLongMessage(result.response, 1600)
            
            console.log(`[Twilio SMS] OUTBOUND`, {
              traceId,
              count: messages.length,
              preview: messages[0]?.slice(0, 40) || 'NO_MESSAGE'
            })
            console.log(`[Twilio SMS] Sending ${messages.length} async message(s) to user at ${from}`)
            
            // Send via Twilio API
            // Add small delay between messages to avoid rate limiting
            for (let i = 0; i < messages.length; i++) {
              const message = messages[i]
              try {
                // Add delay between messages (except first one)
                if (i > 0) {
                  await new Promise(resolve => setTimeout(resolve, 500)) // 500ms delay
                }
                
                console.log(`[Twilio SMS] Sending async message ${i + 1}/${messages.length} to ${from} (length: ${message.length})`)
                const smsResult = await sendSms(from, message, { retries: 1, retryDelay: 2000 })
                if (smsResult.ok) {
                  if (smsResult.deliveryError) {
                    console.warn(`[Twilio SMS] Message ${i + 1} accepted but delivery may fail: ${smsResult.error}`)
                  } else {
                    console.log(`[Twilio SMS] Async message ${i + 1} sent successfully, SID: ${smsResult.sid}`)
                  }
                } else {
                  console.error(`[Twilio SMS] Failed to send async message ${i + 1}: ${smsResult.error}`)
                  // Don't break the loop - continue sending remaining messages
                }
              } catch (err) {
                console.error(`[Twilio SMS] Error sending async message ${i + 1}:`, err)
                // Don't break the loop - continue sending remaining messages
              }
            }
            console.log(`[Twilio SMS] Finished sending all async messages`)
          })
          .catch(async (err) => {
            clearTimeout(watchdog)
            clearTimeout(asyncTimeout)
            console.error(`[Twilio SMS] [${traceId}] Async handler error:`, err)
            console.error(`[Twilio SMS] [${traceId}] Error stack:`, err instanceof Error ? err.stack : 'No stack trace')
            // Send error message to user (only if watchdog hasn't already sent something)
            if (!watchdogFired) {
              try {
                const smsResult = await sendSms(from, "Sorry, I encountered an error processing your query. Please try again.")
                if (smsResult.ok) {
                  console.log(`[Twilio SMS] [${traceId}] Error message sent successfully`)
                } else {
                  console.error(`[Twilio SMS] [${traceId}] Failed to send error message: ${smsResult.error}`)
                }
              } catch (e) {
                console.error(`[Twilio SMS] [${traceId}] Failed to send error message:`, e)
              }
            }
          })
        
        return ackResponse
      }
      
      // For non-content queries (commands, smalltalk, etc.), process synchronously
      // Pass the already-classified intent to avoid redundant LLM call
      const result = await handleSMSMessage(phoneNumber, from, body, intent, history)
      
      console.log(`[Twilio SMS] Unified handler returned: "${result.response.substring(0, 100)}..."`)
      
      // Ensure we have a response
      if (!result.response || result.response.trim().length === 0) {
        console.error('[Twilio SMS] Unified handler returned empty response!')
        throw new Error('Empty response from unified handler')
      }
      
      // Save conversation history if needed
      if (result.shouldSaveHistory) {
        try {
          await supabase.from('sms_conversation_history').insert({
            phone_number: phoneNumber,
            user_message: body,
            bot_response: result.response
          })
        } catch (err) {
          console.error('[Twilio SMS] Failed to save conversation history:', err)
        }
      }
      
      // Split long messages
      const messages = splitLongMessage(result.response, 1600)
      
      console.log(`[Twilio SMS] Sending ${messages.length} message(s) to user`)
      
      if (messages.length === 1) {
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${messages[0]}</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else {
        const messagesXml = messages.map(msg => `  <Message>${msg}</Message>`).join('\n')
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response>\n${messagesXml}\n</Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    } catch (err) {
      console.error('[Twilio SMS] Unified handler error:', err)
      // Fall through to legacy handlers below
    }

    // ========================================================================
    // LEGACY HANDLERS (Fallback - kept for compatibility)
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
    const textRaw = (body || '').trim()
    const lowerBody = textRaw.toLowerCase()
    
    // Create contextMessages string for backward compatibility with older functions
    const contextMessages = recentMessages.map(m => `${m.user_message} ${m.bot_response}`).join(' ').toLowerCase()
    
    // ========================================================================
    // DETERMINISTIC ACTION ROUTER (runs BEFORE LLM classification)
    // ========================================================================
    const activePollDraft = await getActivePollDraft(phoneNumber)
    const activeDraft = await getActiveDraft(phoneNumber)
    const hasActiveDraft = !!(activeDraft || activePollDraft)
    
    // Route to ACTION pipeline if imperative command detected
    const actionRoute = routeAction(textRaw, !!activeDraft)
    const isActionIntent = actionRoute.intent === 'ACTION' && actionRoute.confidence >= 0.9
    
    // If ACTION intent + active draft + edit operation → force edit path, skip query detection
    const forceEditPath = isActionIntent && hasActiveDraft && actionRoute.operation === 'edit'
    
    // If DRAFT_QUERY intent → return draft content directly, skip all other processing
    const isDraftQueryIntent = actionRoute.intent === 'DRAFT_QUERY' && actionRoute.confidence >= 0.9
    
    // If CHAT intent (smalltalk) with high confidence → short response, skip document search
    const isSmalltalkIntent = actionRoute.intent === 'CHAT' && actionRoute.confidence >= 0.9
    
    console.log(`[Twilio SMS] Action router: intent=${actionRoute.intent}, confidence=${actionRoute.confidence}, operation=${actionRoute.operation}, forceEditPath=${forceEditPath}, isDraftQuery=${isDraftQueryIntent}, isSmalltalk=${isSmalltalkIntent}`)
    
    // ========================================================================
    // PRIORITY 0.5: Draft Query Handler (return draft content directly)
    // ========================================================================
    if (isDraftQueryIntent && activeDraft) {
      console.log(`[Twilio SMS] Draft query detected, returning draft content`)
      const draftResponse = `here's what the announcement will say:\n\n${activeDraft.content}\n\nreply "send it" to broadcast or reply to edit`
      
      // Save to conversation history
      await supabase.from('sms_conversation_history').insert({
        phone_number: phoneNumber,
        user_message: textRaw,
        bot_response: draftResponse
      })
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${draftResponse}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    if (isDraftQueryIntent && activePollDraft) {
      console.log(`[Twilio SMS] Poll draft query detected, returning poll draft`)
      const pollResponse = `here's what the poll will say:\n\n${activePollDraft.question}${activePollDraft.options && activePollDraft.options.length > 0 ? `\n\nOptions: ${activePollDraft.options.join(', ')}` : ''}\n\nreply "send it" to send`
      
      // Save to conversation history
      await supabase.from('sms_conversation_history').insert({
        phone_number: phoneNumber,
        user_message: textRaw,
        bot_response: pollResponse
      })
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${pollResponse}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // Classify conversational context using LLM (only if not forcing edit path)
    const conversationalContext = await classifyConversationalContext(
      textRaw,
      lastBotMessage,
      lastUserMessage,
      recentMessages
    )
    
    console.log(`[Twilio SMS] Conversational context: ${conversationalContext.contextType} (confidence: ${conversationalContext.confidence})`)
    
    // Derive flags from LLM context for backward compatibility
    const isPollInputContext = conversationalContext.contextType === 'poll_input'
    const isPollDraftEditContext = conversationalContext.contextType === 'poll_draft_edit'
    const isPollResponseContext = conversationalContext.contextType === 'poll_response'
    
    // Check if last bot message asked for announcement content (fallback if LLM misclassifies)
    const lastBotAskedForAnnouncement = lastBotMessage.toLowerCase().includes('what would you like the announcement to say')
    const isExplicitQuestion = textRaw.includes('?') || /^(what|when|where|who|how|why|is|are|was|were|do|does|did|will|can|could|should)\s/i.test(textRaw.trim())
    const isExplicitAnnouncementRequest = isAnnouncementRequest(textRaw)
    
    // Override: if bot asked for announcement content and user provides non-question content, it's announcement input
    const shouldOverrideAsAnnouncementInput = lastBotAskedForAnnouncement && !isExplicitQuestion && !isExplicitAnnouncementRequest
    console.log(`[Twilio SMS] Announcement context: lastBotAskedForAnnouncement=${lastBotAskedForAnnouncement}, shouldOverride=${shouldOverrideAsAnnouncementInput}, LLM=${conversationalContext.contextType}`)
    
    const isAnnouncementInputContext = conversationalContext.contextType === 'announcement_input' || shouldOverrideAsAnnouncementInput
    const isAnnouncementDraftEditContext = conversationalContext.contextType === 'announcement_draft_edit'
    
    // Legacy flags for backward compatibility (still used in some handlers)
    const isPollDraftContext = isPollDraftEditContext || conversationalContext.contextType === 'poll_input'
    const isPollQuestionInputContext = isPollInputContext
    
    // Override announcement context: if user explicitly requests an announcement, it's NOT input context
    // Conversational context might incorrectly classify "I wanna make an announcement" as announcement_input
    // when it's actually a NEW announcement request
    // Also: questions (containing "?") are NEVER announcement_input
    // CRITICAL: Derive from activeDraft state OR forceEditPath (action router determined edit)
    // This ensures state coherence - if activeDraft exists and action router says edit, it's draft context
    const isAnnouncementDraftContext = (
      (isAnnouncementInputContext || isAnnouncementDraftEditContext || forceEditPath) && 
      !isExplicitAnnouncementRequest && 
      !isExplicitQuestion
    ) || (!!activeDraft && forceEditPath)
    
    // Check if user has an active poll waiting for response (for determining isPollResponseContext with low confidence)
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
    // If LLM has low confidence, fall back to active poll check
    const finalIsPollResponseContext = conversationalContext.confidence < 0.7 && !!hasActivePoll ? !!hasActivePoll : isPollResponseContext
    
    // ========================================================================
    // PRIORITY 0: Send command (HIGHEST - before everything else, but NOT if responding to poll)
    // ========================================================================
    if ((command === 'SEND IT' || command === 'SEND NOW' || isSendAffirmation(textRaw, finalIsPollResponseContext)) && !finalIsPollResponseContext && !isPollQuestionInputContext) {
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
    
    const inferOptionFromInput = (input: string, options: string[]): string | null => {
      const trimmed = (input || '').trim()
      const lower = trimmed.toLowerCase()
      
      // Numeric selection (1-indexed)
      const numMatch = trimmed.match(/^\s*(\d{1,2})\s*$/)
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1
        if (idx >= 0 && idx < options.length) {
          return options[idx]
        }
      }
      
      // Direct option match (case-insensitive, ignore punctuation)
      const cleaned = lower.replace(/[^a-z0-9\s]/g, '').trim()
      const normalizedOptions = options.map(opt => opt.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim())
      const directIdx = normalizedOptions.findIndex(opt => opt === cleaned)
      if (directIdx !== -1) {
        return options[directIdx]
      }
      
      // Keyword heuristics for yes/no/maybe style options
      const yesWords = ['yes', 'yeah', 'yup', 'yep', 'sure', 'absolutely', 'def', 'definitely', 'in', "i'm in", 'count me in', 'i will', 'i\'ll be', 'i can make', 'coming', 'be there']
      const noWords = ['no', 'nah', 'nope', 'can\'t', 'cannot', 'won\'t', 'not coming', 'out', 'i can\'t', 'i cannot', 'i won\'t', 'i\'m out']
      const maybeWords = ['maybe', 'not sure', 'depends', 'possibly', 'might']
      
      const containsAny = (words: string[]) => words.some(word => lower.includes(word))
      
      if (options.some(opt => opt.toLowerCase() === 'yes') && containsAny(yesWords)) {
        return options.find(opt => opt.toLowerCase() === 'yes') || null
      }
      
      if (options.some(opt => opt.toLowerCase() === 'no') && containsAny(noWords)) {
        return options.find(opt => opt.toLowerCase() === 'no') || null
      }
      
      if (options.some(opt => opt.toLowerCase() === 'maybe') && containsAny(maybeWords)) {
        return options.find(opt => opt.toLowerCase() === 'maybe') || null
      }
      
      return null
    }
    
    // ========================================================================
    // PRIORITY 1: Poll Response (HIGH - before queries)
    // ========================================================================
    if (finalIsPollResponseContext && !isPollDraftContext && !isPollQuestionInputContext && !isPollRequest(textRaw) && !isAnnouncementRequest(textRaw)) {
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

          // Router-aware guard: classify high-level intent
          const routePre = classifyIntent(textRaw, contextMessages)
          const looksLikeAnswer = isLikelyPollAnswer(textRaw, options)
          const parsed = await parseResponseWithNotes(body, options)
          
          // If conversational context classifier says poll_response with high confidence, trust it
          const isHighConfidencePollResponse = finalIsPollResponseContext && conversationalContext.confidence >= 0.8
          const qualifiesAsPollAnswer = !!parsed.option || looksLikeAnswer || isHighConfidencePollResponse
          
          if (!qualifiesAsPollAnswer || routePre.intent === 'abusive') {
            console.log(`[Twilio SMS] Not treating message as poll response (qualifies=${qualifiesAsPollAnswer}, looksLikeAnswer=${looksLikeAnswer}, routeIntent=${routePre.intent}, highConfPoll=${isHighConfidencePollResponse}, parsed=${parsed.option})`)
            throw new Error('NotAPollAnswer')
          }
          
          if (isHighConfidencePollResponse) {
            console.log(`[Twilio SMS] High-confidence poll response detected, proceeding despite route intent: ${routePre.intent}`)
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
          
          const resolvedOption = parsed.option ?? inferOptionFromInput(body, options)
          
          if (resolvedOption) {
            // Successfully parsed - record it
            const success = await recordPollResponse(
              poll.id,
              phoneE164,
              resolvedOption,
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
              `got you, ${personName}. marked: ${resolvedOption}${notesText}`,
              `copy that ${personName} — logged ${resolvedOption}${notesText}`,
              `${personName}, noted: ${resolvedOption}${notesText}`,
              `all right ${personName}, putting you down as ${resolvedOption}${notesText}`
            ]
            const reply = `${sassy[Math.floor(Math.random()*sassy.length)]}${linkLine}`
            
            return new NextResponse(
              '<?xml version="1.0" encoding="UTF-8"?>' +
              `<Response><Message>${reply}</Message></Response>`,
              { headers: { 'Content-Type': 'application/xml' } }
            )
          } else {
            // Couldn't resolve option even though it looked like a poll answer
            console.log('[Twilio SMS] Could not parse poll response after inference, falling through')
          }
        }
      } catch (err) {
        console.error('[Twilio SMS] Poll response handling error:', err)
        // Fall through to other handlers
      }
    }
    
    // ========================================================================
    // SESSION STATE MACHINE (if enabled - HIGHEST PRIORITY after polls)
    // ========================================================================
    // Skip if this is a poll response - poll responses need special handling
    const isPollResponse = finalIsPollResponseContext && !isPollDraftContext && !isPollQuestionInputContext && !isPollRequest(textRaw) && !isAnnouncementRequest(textRaw)
    
    if (USE_SESSION_STATE_MACHINE && !isPollResponse) {
      try {
        console.log(`[Session State Machine] Handling turn for ${phoneNumber}`)
        
        // Use the new session-based state machine
        const { response, state } = await handleSessionTurn(phoneNumber, body)
        
        console.log(`[Session State Machine] Response: "${response}", Mode: ${state.mode}`)
        
        // Save to conversation history
        await supabase.from('sms_conversation_history').insert({
          phone_number: phoneNumber,
          user_message: body,
          bot_response: response
        })
        
        // Convert to TwiML and return
        const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response}</Message></Response>`
        return new NextResponse(twiml, { headers: { 'Content-Type': 'application/xml' } })
      } catch (error) {
        console.error('[Session State Machine] Error, falling back to orchestrator:', error)
        // Fall through to orchestrator
      }
    }
    
    // ========================================================================
    // ORCHESTRATOR-BASED FLOW (if enabled, but AFTER poll responses)
    // ========================================================================
    if (USE_ORCHESTRATOR && !isPollResponse) {
      try {
        // Get user/org context if available
        const { data: userData } = await supabase
          .from('sms_optin')
          .select('user_id, space_id')
          .eq('phone', phoneNumber)
          .maybeSingle()
        
        const userId = userData?.user_id || undefined
        const orgId = userData?.space_id || undefined
        
        // Handle turn with orchestrator
        const result = await handleTurn(phoneNumber, body, userId, orgId)
        
        // Convert to TwiML and return
        const twiml = toTwiml(result.messages)
        return new NextResponse(twiml, { headers: { 'Content-Type': 'application/xml' } })
      } catch (error) {
        console.error('[Twilio SMS] Orchestrator error, falling back to old flow:', error)
        // Fall through to old flow
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
        const askMsg = 'what would you like to ask in the poll?'
        
        // Save to conversation history so next message is recognized as poll input
        await supabase.from('sms_conversation_history').insert({
          phone_number: phoneNumber,
          user_message: textRaw,
          bot_response: askMsg
        })
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${askMsg}</Message></Response>`,
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
    // Also skip if conversational context indicates announcement/poll action (even if it looks like a query)
    // BUT: exclude explicit announcement requests - those should go to announcement handler, not be blocked
    const isActionContext = conversationalContext.confidence >= 0.7 && (
      conversationalContext.contextType === 'announcement_input' ||
      conversationalContext.contextType === 'announcement_draft_edit' ||
      conversationalContext.contextType === 'poll_input' ||
      conversationalContext.contextType === 'poll_draft_edit' ||
      conversationalContext.contextType === 'poll_response'
    ) && !isExplicitAnnouncementRequest // Don't block explicit announcement requests
    
    console.log(`[Twilio SMS] Query detection: looksLikeQuery=${looksLikeQuery}, isPollDraftContext=${isPollDraftContext}, isAnnouncementDraftContext=${isAnnouncementDraftContext}, isActionContext=${isActionContext}, forceEditPath=${forceEditPath}, willSkipQuery=${!isPollDraftContext && !isAnnouncementDraftContext && !isActionContext && !forceEditPath}`)
    
    // ========================================================================
    // PRIORITY 0.6: Smalltalk Handler (short, polite responses)
    // ========================================================================
    if (isSmalltalkIntent) {
      console.log(`[Twilio SMS] Smalltalk detected: "${textRaw}"`)
      const smalltalkResponses: Record<string, string> = {
        'thanks?': 'you\'re welcome! 😊',
        'thank you': 'you\'re welcome! 😊',
        'ty': 'np! 😊',
        'thx': 'np! 😊',
        'hi': 'hey! what\'s up?',
        'hey': 'hey! what\'s up?',
        'hello': 'hey! what\'s up?',
        'ok': 'cool 👍',
        'okay': 'cool 👍',
        'alright': 'sounds good 👍',
        'sure': 'cool 👍',
        'got it': 'awesome 👍',
        'sounds good': 'great! 👍',
        'cool': '😎',
        'nice': '😎',
        'sweet': '😎',
        'awesome': '😎',
        'great': '😎',
      }
      
      const lowerMsg = textRaw.toLowerCase().trim()
      const response = smalltalkResponses[lowerMsg] || '👍'
      
      // Check for drafts to mention
      let draftFollowUp = ''
      if (activeDraft) {
        draftFollowUp = `\n\nbtw you have an announcement draft ready - reply "send it" to send`
      } else if (activePollDraft) {
        draftFollowUp = `\n\nbtw you have a poll draft ready: "${activePollDraft.question}" - reply "send it" to send`
      }
      
      const finalResponse = `${response}${draftFollowUp}`
      
      // Save to conversation history
      await supabase.from('sms_conversation_history').insert({
        phone_number: phoneNumber,
        user_message: textRaw,
        bot_response: finalResponse
      })
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${finalResponse}</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // SKIP query detection if forceEditPath (action router determined this is an edit command)
    // OR if smalltalk (thank you, etc.) - just respond politely without document search
    if (looksLikeQuery && !isPollDraftContext && !isAnnouncementDraftContext && !finalIsPollResponseContext && !isPollQuestionInputContext && !isActionContext && !isExplicitAnnouncementRequest && !forceEditPath && !isSmalltalkIntent) {
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
          const askMsg = 'what would you like to ask in the poll?'
          
          // Save to conversation history so next message is recognized as poll input
          await supabase.from('sms_conversation_history').insert({
            phone_number: phoneNumber,
            user_message: textRaw,
            bot_response: askMsg
          })
          
          return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${askMsg}</Message></Response>`,
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
    
    // Announcement content input (when bot asked "what would you like the announcement to say?" but no draft exists yet)
    // OR if bot asked for content and draft exists - treat as editing (prioritize over query detection)
    console.log(`[Twilio SMS] Announcement input check: isAnnouncementDraftContext=${isAnnouncementDraftContext}, activeDraft=${!!activeDraft}, isPollRequest=${isPollRequest(textRaw)}, isAnnouncementRequest=${isAnnouncementRequest(textRaw)}, looksLikeQuery=${looksLikeQuery}, lastBotAskedForAnnouncement=${lastBotAskedForAnnouncement}`)
    
    // If bot asked for announcement content and user provides input, prioritize announcement handling over query
    // This handles both new draft creation AND editing existing drafts when bot asked for content
    if (isAnnouncementDraftContext && lastBotAskedForAnnouncement && !isPollRequest(textRaw) && !isAnnouncementRequest(textRaw)) {
      // If no draft exists, create one
      if (!activeDraft) {
        console.log(`[Twilio SMS] Creating announcement draft with user content: "${textRaw}"`)
      
      const announcementText = extractRawAnnouncementText(body)
      
        // Generate draft from the content
        const spaceIds = await getWorkspaceIds()
        const draft = await generateAnnouncementDraft({ content: announcementText })
        console.log(`[Twilio SMS] Generated draft: "${draft}"`)
        
        // Save new draft
        const draftId = await saveDraft(phoneNumber, {
          content: draft,
          tone: 'casual',
          scheduledFor: undefined,
          targetAudience: undefined,
          workspaceId: spaceIds[0]
        }, spaceIds[0])
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>okay here's what the announcement will say:\n\n${draft}\n\nreply "send it" to broadcast or reply to edit the message</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else {
        // Draft exists - treat as editing (use intelligent patching)
        console.log(`[Twilio SMS] Editing announcement draft with user content: "${textRaw}" (prioritized over query detection)`)
        
        let patchedContent: string
        const wantsToCopy = /(copy|use|take)\s+(what|exactly\s+what)\s+(i|I)\s+(wrote|said|typed|sent)/i.test(textRaw) || 
                            /that'?s\s+(the\s+same\s+thing|what\s+i\s+wrote|exactly\s+what\s+i\s+wrote)/i.test(textRaw)
        
        if (wantsToCopy && recentMessages.length > 0) {
          const previousUserMessage = recentMessages.find(m => {
            const msg = m.user_message.toLowerCase().trim()
            return msg.length > 10 && !/^(thanks?|thank\s+you|ty|ok|okay)/i.test(msg)
          })?.user_message
          
          if (previousUserMessage && previousUserMessage.length > 10) {
            console.log(`[Twilio SMS] Copying previous user message: "${previousUserMessage}"`)
            patchedContent = previousUserMessage.trim()
          } else {
            patchedContent = extractRawAnnouncementText(body)
          }
        } else if (isExactTextRequest(body)) {
          patchedContent = extractRawAnnouncementText(body)
        } else {
          // Use intelligent patching to merge the new content
          patchedContent = patchAnnouncementDraft(activeDraft.content || '', textRaw)
        }
        
      await saveDraft(phoneNumber, {
        id: activeDraft.id,
          content: patchedContent,
        tone: activeDraft.tone,
        scheduledFor: activeDraft.scheduledFor,
        targetAudience: activeDraft.targetAudience,
        workspaceId: activeDraft.workspaceId
      }, activeDraft.workspaceId!)
      
      return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>updated:\n\n${patchedContent}\n\nreply "send it" to broadcast</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      }
    }
    
    // Announcement draft editing (only if in announcement context AND not a query)
    // Also check conversational context - if it says announcement_draft_edit, trust it
    // OR if action router determined this is an edit (forceEditPath)
    const isEditingDraft = (isAnnouncementDraftContext || conversationalContext.contextType === 'announcement_draft_edit' || forceEditPath) && activeDraft
    if (isEditingDraft && !isPollRequest(textRaw) && !isAnnouncementRequest(textRaw) && (!looksLikeQuery || forceEditPath)) {
      console.log(`[Twilio SMS] Editing announcement draft in context: "${textRaw}" (forceEditPath=${forceEditPath})`)
      
      // Use intelligent patching instead of regenerating
      // This preserves existing content and only applies the specific edit
      let patchedContent: string
      
      // Check if user wants to copy what they wrote (extract from previous message)
      const wantsToCopy = /(copy|use|take)\s+(what|exactly\s+what)\s+(i|I)\s+(wrote|said|typed|sent)/i.test(textRaw) || 
                          /that'?s\s+(the\s+same\s+thing|what\s+i\s+wrote|exactly\s+what\s+i\s+wrote)/i.test(textRaw)
      
      if (wantsToCopy && recentMessages.length > 0) {
        // Find the most recent user message that contains actual content (not just "thank you" etc)
        const previousUserMessage = recentMessages.find(m => {
          const msg = m.user_message.toLowerCase().trim()
          return msg.length > 10 && !/^(thanks?|thank\s+you|ty|ok|okay)/i.test(msg)
        })?.user_message
        
        if (previousUserMessage && previousUserMessage.length > 10) {
          console.log(`[Twilio SMS] Copying previous user message: "${previousUserMessage}"`)
          patchedContent = previousUserMessage.trim()
        } else {
          // Fallback: use extractRawAnnouncementText
          patchedContent = extractRawAnnouncementText(body)
        }
      } else if (isExactTextRequest(body)) {
        // Exact text request - use extractRawAnnouncementText
        patchedContent = extractRawAnnouncementText(body)
      } else if (forceEditPath || actionRoute.operation === 'edit') {
        // Action router determined edit - use patchAnnouncementDraft
        patchedContent = patchAnnouncementDraft(activeDraft.content || '', textRaw)
      } else {
        // Fallback to extractRawAnnouncementText
        patchedContent = extractRawAnnouncementText(body)
      }
      
      await saveDraft(phoneNumber, {
        id: activeDraft.id,
        content: patchedContent,
        tone: activeDraft.tone,
        scheduledFor: activeDraft.scheduledFor,
        targetAudience: activeDraft.targetAudience,
        workspaceId: activeDraft.workspaceId
      }, activeDraft.workspaceId!)
      
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>updated:\n\n${patchedContent}\n\nreply "send it" to broadcast</Message></Response>`,
        { headers: { 'Content-Type': 'application/xml' } }
      )
    }
    
    // Announcement request (if NOT in draft context)
    // Prioritize explicit announcement requests - if user says "I wanna make an announcement",
    // handle it as a NEW request even if conversational context misclassified it
    if (isAnnouncementRequest(textRaw) && !isPollDraftContext && !isAnnouncementDraftContext && !isPollRequest(textRaw)) {
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
        const askMsg = 'what would you like the announcement to say?'
        
        // Save to conversation history so next message is recognized as announcement input
        await supabase.from('sms_conversation_history').insert({
          phone_number: phoneNumber,
          user_message: textRaw,
          bot_response: askMsg
        })
        
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${askMsg}</Message></Response>`,
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
    
    // Check if user wants to delete/cancel a draft
    const wantsDelete = /(delete|cancel|remove)\s+(the\s+)?(announcement|poll|draft)/i.test(body)
    if (wantsDelete && (activeDraft || activePollDraft)) {
      console.log(`[Twilio SMS] User wants to delete draft for ${phoneNumber}`)
      
      // Determine which to delete
      let deletedType = ''
      if (activeDraft && body.toLowerCase().includes('announcement')) {
        // Delete announcement draft
        const { error } = await supabase
          .from('announcement')
          .delete()
          .eq('id', activeDraft.id)
        
        if (error) {
          console.error(`[Twilio SMS] Failed to delete announcement draft:`, error)
        } else {
          deletedType = 'announcement'
          console.log(`[Twilio SMS] Deleted announcement draft ${activeDraft.id}`)
        }
      } else if (activePollDraft && body.toLowerCase().includes('poll')) {
        // Delete poll draft
        const { error } = await supabase
          .from('sms_poll')
          .delete()
          .eq('id', activePollDraft.id)
        
        if (error) {
          console.error(`[Twilio SMS] Failed to delete poll draft:`, error)
        } else {
          deletedType = 'poll'
          console.log(`[Twilio SMS] Deleted poll draft ${activePollDraft.id}`)
        }
      } else if (activePollDraft) {
        // Delete poll draft (default if both exist)
        const { error } = await supabase
          .from('sms_poll')
          .delete()
          .eq('id', activePollDraft.id)
        
        if (error) {
          console.error(`[Twilio SMS] Failed to delete poll draft:`, error)
        } else {
          deletedType = 'poll'
          console.log(`[Twilio SMS] Deleted poll draft ${activePollDraft.id}`)
        }
      } else if (activeDraft) {
        // Delete announcement draft (default if only announcement exists)
        const { error } = await supabase
          .from('announcement')
          .delete()
          .eq('id', activeDraft.id)
        
        if (error) {
          console.error(`[Twilio SMS] Failed to delete announcement draft:`, error)
        } else {
          deletedType = 'announcement'
          console.log(`[Twilio SMS] Deleted announcement draft ${activeDraft.id}`)
        }
      }
      
      if (deletedType) {
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>got it. deleted the ${deletedType} draft.</Message></Response>`,
          { headers: { 'Content-Type': 'application/xml' } }
        )
      } else {
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>couldn't find a draft to delete</Message></Response>`,
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
    // New user welcome flow is now handled in PRIORITY 0.5 above (before orchestrator)

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
        const clar = "got you — what didn't make sense? want me to explain what/when/where?"
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
    // TEMPORARILY DISABLED: Skip the new router to force planner flow
    // const route = classifyIntent(query, contextMessages)
    // const contentItems = await retrieveContent(query, spaceIds)
    // const convoItems = await retrieveConvo(phoneNumber)
    // const enclaveItems = await retrieveEnclave(query)
    // const actionItems = await retrieveAction(phoneE164)
    // const decision = combine({ intent: route.intent, content: contentItems as any, convo: convoItems as any, enclave: enclaveItems as any, action: actionItems as any })
    // if (decision.type === 'answer' && decision.confidence >= 0.5) {
    //   const finalMsg = ((toneDecision.prefix || '') + decision.message)
    //   await supabase.from('sms_conversation_history').insert({ phone_number: phoneNumber, user_message: query, bot_response: finalMsg })
    //   const msgs = splitLongMessage(finalMsg, 1600)
    //   if (msgs.length === 1) {
    //     return new NextResponse(
    //       `<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>${msgs[0]}</Message></Response>`,
    //       { headers: { 'Content-Type': 'application/xml' } }
    //     )
    //   }
    //   const messageXml = msgs.map(m => `  <Message>${m}</Message>`).join('\n')
    //   return new NextResponse(
    //     `<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response>\n${messageXml}\n</Response>`,
    //     { headers: { 'Content-Type': 'application/xml' } }
    //   )
    // }

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
        
        // Ensure we have a response - use finalText if available, otherwise fall back to composed.text
        const finalResponse = finalText || composed.text || 'I couldn\'t find information about that. Try asking about events, policies, or people.'
        
        // Store query answer for later
        queryAnswer = finalResponse
        
        // Format response
        let responseMessage = ''
        
        // Add main response
        responseMessage += finalResponse
        
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
        
        // Ensure responseMessage is not empty
        if (!responseMessage || responseMessage.trim().length === 0) {
          console.error(`[Twilio SMS] ERROR: responseMessage is empty! finalText=${finalText}, composed.text=${composed.text}`)
          responseMessage = 'I couldn\'t process that request. Try asking about events, policies, or people.'
        }
        
        // Save conversation history
        try {
        await supabase
          .from('sms_conversation_history')
          .insert({
            phone_number: phoneNumber,
            user_message: query,
            bot_response: responseMessage
          })
        } catch (err) {
          console.error(`[Twilio SMS] Failed to save conversation history:`, err)
          // Continue anyway - don't fail the response
        }
        
        // Split and send
        const messages = splitLongMessage(responseMessage, 1600)
        
        if (messages.length === 0) {
          console.error(`[Twilio SMS] ERROR: splitLongMessage returned empty array!`)
          messages.push('I couldn\'t process that request. Try asking about events, policies, or people.')
        }
        
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

