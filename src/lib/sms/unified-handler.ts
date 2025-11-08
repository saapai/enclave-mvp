/**
 * Unified SMS Handler
 * 
 * Main entry point that orchestrates:
 * - Welcome flow
 * - Context-aware intent classification
 * - Smart command parsing
 * - Announcement/poll generation
 * - Query handling
 */

import { classifyIntent, loadWeightedHistory, IntentType, ConversationMessage } from './context-aware-classifier'
import { parseCommand, ParsedCommand } from './smart-command-parser'
import { needsWelcome, getWelcomeMessage, handleNameInWelcome, initializeNewUser } from './welcome-flow'
import { generateAnnouncement, formatAnnouncement, AnnouncementDraft } from './enhanced-announcement-generator'
import { checkActionQuery, saveAction } from './action-memory'
import { supabaseAdmin } from '@/lib/supabase'
// Name declaration is handled inline

export interface HandlerResult {
  response: string
  shouldSaveHistory: boolean
  metadata?: {
    intent?: IntentType
    draftCreated?: boolean
    welcomeComplete?: boolean
  }
}

/**
 * Main handler for incoming SMS messages
 */
export async function handleSMSMessage(
  phoneNumber: string,
  fullPhoneNumber: string, // E.164 format
  messageText: string
): Promise<HandlerResult> {
  console.log(`[UnifiedHandler] Processing message from ${phoneNumber}: "${messageText}"`)

  // Load conversation history
  const history = await loadWeightedHistory(phoneNumber, 10)

  // Check welcome flow first
  const needsWelcomeFlow = await needsWelcome(phoneNumber)
  if (needsWelcomeFlow) {
    // Check if this is a name declaration
    const nameCheck = await checkNameDeclaration(messageText)
    if (nameCheck.isName && nameCheck.name) {
      // Initialize user if needed
      await initializeNewUser(phoneNumber, fullPhoneNumber)
      
      // Handle name
      const result = await handleNameInWelcome(phoneNumber, nameCheck.name, fullPhoneNumber)
      
      return {
        response: result.message,
        shouldSaveHistory: true,
        metadata: {
          welcomeComplete: result.complete
        }
      }
    } else {
      // Send welcome message
      await initializeNewUser(phoneNumber, fullPhoneNumber)
      return {
        response: getWelcomeMessage(),
        shouldSaveHistory: true,
        metadata: {}
      }
    }
  }

  // Classify intent FIRST using LLM (it will detect follow-ups)
  const intent = await classifyIntent(messageText, history)
  console.log(`[UnifiedHandler] Intent: ${intent.type} (confidence: ${intent.confidence}, isFollowUp: ${intent.isFollowUp})`)
  
  // Handle follow-up queries based on LLM classification
  if (intent.type === 'follow_up_query' || intent.isFollowUp) {
    console.log(`[UnifiedHandler] Detected follow-up question, checking action memory`)
    const { getRecentActions } = await import('./action-memory')
    const recentActions = await getRecentActions(phoneNumber, 10)
    
    // Find ALL recent query actions that haven't been answered yet
    const recentQueries = recentActions.filter(a => a.type === 'query').slice(0, 3) // Last 3 queries
    
    if (recentQueries.length > 0) {
      // Check if any queries have answers
      const answeredQueries = recentQueries.filter(q => (q.details.queryResults || 0) > 0 && q.details.queryAnswer)
      
      if (answeredQueries.length > 0) {
        // Return the most recent answered query
        const lastAnswered = answeredQueries[0]
        console.log(`[UnifiedHandler] Found previous query result: "${lastAnswered.details.query}"`)
        return {
          response: lastAnswered.details.queryAnswer || "i couldn't find information about that.",
          shouldSaveHistory: true,
          metadata: { intent: 'content_query' }
        }
      } else {
        // Check if queries are still processing (recent but no results yet)
        const pendingQueries = recentQueries.filter(q => !q.details.queryResults && !q.details.queryAnswer)
        if (pendingQueries.length > 0) {
          return {
            response: "still processing your queries, give me a sec!",
            shouldSaveHistory: true,
            metadata: { intent: 'content_query' }
          }
        } else {
          // Queries were attempted but found nothing
          const failedQueries = recentQueries.filter(q => q.details.queryResults === 0)
          if (failedQueries.length > 0) {
            return {
              response: `i couldn't find information about "${failedQueries[0].details.query}".`,
              shouldSaveHistory: true,
              metadata: { intent: 'content_query' }
            }
          }
        }
      }
    }
    
    // If no recent queries found, check conversation history for unanswered questions
    const lastUserMessages = history.filter(m => m.role === 'user').slice(-3)
    if (lastUserMessages.length > 0) {
      const unansweredQuestions = lastUserMessages.filter(msg => 
        /^(what|when|where|who|how|why)/i.test(msg.text.trim())
      )
      if (unansweredQuestions.length > 0) {
        return {
          response: `i'm still working on "${unansweredQuestions[0].text}". give me a moment!`,
          shouldSaveHistory: true,
          metadata: { intent: 'content_query' }
        }
      }
    }
    
    // If nothing found, continue with normal flow
    console.log(`[UnifiedHandler] No recent queries found in action memory, continuing with normal flow`)
  }

  // Handle simple questions based on LLM classification
  // Use LLM to generate appropriate response based on the question
  if (intent.type === 'simple_question') {
    try {
      // Use LLM to answer simple questions contextually
      const { ENV } = await import('@/lib/env')
      const aiResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ENV.MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [
            {
              role: 'system',
              content: `You are Jarvis, an SMS bot powered by Enclave. Answer the user's simple question directly and conversationally.

Enclave System Reference:
- Name: Jarvis
- Type: Multi-modal organizational AI assistant platform
- Purpose: Unify organization's communications and knowledge across SMS, Slack, Google Calendar, Docs
- Primary developer: Saathvik Pai
- Core team: The Inquiyr development team
- Built as part of the Inquiyr ecosystem
- Technical stack: Next.js, TypeScript, Supabase, Twilio, Mistral AI
- Capabilities: Knowledge retrieval, SMS messaging, announcements, polls, alerts, search
- Target users: Student organizations, professional fraternities, small teams, clubs

Context from conversation:
${history.slice(-5).map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.text}`).join('\n')}

Rules:
- If they ask about your name, respond based on the information in the Enclave System Reference
- If they ask how you are, talk about how you're doing and how you can help them
- If they criticize you or say you
- NEVER use emojis
- Keep responses brief (1-2 sentences max) and friendly`
            },
            {
              role: 'user',
              content: messageText
            }
          ],
          temperature: 0.7,
          max_tokens: 100
        })
      })
      
      if (aiResponse.ok) {
        const aiData = await aiResponse.json()
        const response = aiData.choices?.[0]?.message?.content || ''
        if (response.trim().length > 0) {
          return {
            response: response.trim(),
            shouldSaveHistory: true,
            metadata: { intent: 'simple_question' }
          }
        }
      }
    } catch (err) {
      console.error('[UnifiedHandler] Simple question LLM failed:', err)
    }
    
    // Fallback response (no emojis)
    return {
      response: "i'm jarvis, part of enclave! how can i help?",
      shouldSaveHistory: true,
      metadata: { intent: 'simple_question' }
    }
  }

  // Handle based on intent
  switch (intent.type) {
    case 'name_declaration':
      return handleNameDeclaration(phoneNumber, fullPhoneNumber, messageText)

    case 'announcement_command':
      return handleAnnouncementCommand(phoneNumber, messageText, history)

    case 'poll_command':
      return handlePollCommand(phoneNumber, messageText, history)

    case 'announcement_edit':
      return handleAnnouncementEdit(phoneNumber, messageText, history)

    case 'poll_edit':
      return handlePollEdit(phoneNumber, messageText, history)

    case 'control_command':
      return handleControlCommand(phoneNumber, messageText)

    case 'poll_response':
      return handlePollResponse(phoneNumber, messageText)

    case 'random_conversation':
      return handleSmalltalk(messageText, history)
    
    case 'content_query':
    case 'enclave_query':
      return handleQuery(phoneNumber, messageText, intent.type)

    default:
      return {
        response: "i didn't quite get that. try asking a question, or say 'send a message' to create an announcement.",
        shouldSaveHistory: true,
        metadata: { intent: intent.type }
      }
  }
}

/**
 * Check if message is a name declaration
 */
async function checkNameDeclaration(message: string): Promise<{ isName: boolean; name?: string }> {
  // Try to import the existing function
  try {
    // Use LLM-based name detection
    const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
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

ONLY return true if they're clearly stating their name. Return JSON only.`,
        context: '',
        type: 'general'
      })
    })

    if (aiRes.ok) {
      const aiData = await aiRes.json()
      const response = aiData.response || '{}'
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return { isName: parsed.isName || false, name: parsed.name || undefined }
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Name detection failed:', err)
  }
  return { isName: false }
}

/**
 * Handle name declaration
 */
async function handleNameDeclaration(
  phoneNumber: string,
  fullPhoneNumber: string,
  messageText: string
): Promise<HandlerResult> {
  const nameCheck = await checkNameDeclaration(messageText)
  if (nameCheck.isName && nameCheck.name) {
    const result = await handleNameInWelcome(phoneNumber, nameCheck.name, fullPhoneNumber)
    return {
      response: result.message,
      shouldSaveHistory: true,
      metadata: { welcomeComplete: result.complete }
    }
  }
  
  return {
    response: "what's your name?",
    shouldSaveHistory: true
  }
}

/**
 * Handle announcement command
 */
async function handleAnnouncementCommand(
  phoneNumber: string,
  messageText: string,
  history: ConversationMessage[]
): Promise<HandlerResult> {
  // Parse command
  const parsed = await parseCommand(messageText, history)

  // Check if content was provided
  const hasContent = parsed.extractedFields.content && 
                     parsed.extractedFields.content.trim().length > 0 &&
                     parsed.extractedFields.content !== 'Announcement'
  
  if (!hasContent && !parsed.verbatimText) {
    // No content provided, ask for it
    return {
      response: "what would you like the announcement to say?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'announcement_command'
      }
    }
  }

  // Generate announcement
  const draft = await generateAnnouncement(parsed)
  
  // Ensure draft has content
  if (!draft.content || draft.content.trim().length === 0 || draft.content === 'Announcement') {
    return {
      response: "what would you like the announcement to say?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'announcement_command'
      }
    }
  }
  
  // Save draft using existing function
  try {
    const { saveDraft } = await import('@/lib/announcements')
    const { getWorkspaceIds } = await import('@/lib/workspace')
    
    // Get workspace IDs
    const spaceIds = await getWorkspaceIds()
    const workspaceId = spaceIds[0] || null
    
    if (workspaceId) {
      // Parse date safely
      let scheduledDate: Date | undefined = undefined
      if (draft.date) {
        try {
          // If it's already a date string (YYYY-MM-DD), parse it
          const parsedDate = new Date(draft.date)
          if (!isNaN(parsedDate.getTime())) {
            scheduledDate = parsedDate
          } else {
            console.warn('[UnifiedHandler] Invalid date format:', draft.date)
          }
        } catch (err) {
          console.error('[UnifiedHandler] Error parsing date:', draft.date, err)
        }
      }
      
      await saveDraft(phoneNumber, {
        content: draft.content,
        targetAudience: draft.audience || 'all',
        scheduledFor: scheduledDate,
        workspaceId
      }, workspaceId)
      
      // Save action memory
      await saveAction(phoneNumber, {
        type: 'draft_created',
        details: {
          draftType: 'announcement',
          announcementContent: draft.content
        }
      })
    } else {
      console.warn('[UnifiedHandler] No workspace found, skipping draft save')
    }
  } catch (err) {
    console.error('[UnifiedHandler] Error saving announcement draft:', err)
  }

  const preview = formatAnnouncement(draft)
  return {
    response: `okay, here's what the announcement will say:\n\n${preview}\n\nreply "send it" to broadcast or reply to edit`,
    shouldSaveHistory: true,
    metadata: {
      intent: 'announcement_command',
      draftCreated: true
    }
  }
}

/**
 * Handle poll command
 */
async function handlePollCommand(
  phoneNumber: string,
  messageText: string,
  history: ConversationMessage[]
): Promise<HandlerResult> {
  try {
    const { extractPollDetails, generatePollQuestion, savePollDraft, getActivePollDraft } = await import('@/lib/polls')
    
    // Parse command to see if question is included
    const parsed = await parseCommand(messageText, history)
    
    // Check if question is provided
    if (parsed.extractedFields.content) {
      // Generate conversational poll question
      const pollQuestion = await generatePollQuestion({ question: parsed.extractedFields.content })
      
      // Get workspace IDs
      const { getWorkspaceIds } = await import('@/lib/workspace')
      const spaceIds = await getWorkspaceIds()
      const workspaceId = spaceIds[0] || null
      
      // Save draft
      await savePollDraft(phoneNumber, {
        question: pollQuestion,
        options: ['Yes', 'No', 'Maybe'],
        workspaceId: workspaceId || undefined
      }, workspaceId || '')
      
      return {
        response: `okay, here's what the poll will say:\n\n${pollQuestion}\n\nreply "send it" to send or reply to edit the message`,
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_command',
          draftCreated: true
        }
      }
    } else {
      // Ask for question
      return {
        response: "what would you like to ask in the poll?",
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_command'
        }
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Poll command error:', err)
    return {
      response: "what would you like to ask in the poll?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_command'
      }
    }
  }
}

/**
 * Handle announcement edit
 */
async function handleAnnouncementEdit(
  phoneNumber: string,
  messageText: string,
  history: ConversationMessage[]
): Promise<HandlerResult> {
  // Get existing draft
  const { getActiveDraft } = await import('@/lib/announcements')
  const existingDraft = await getActiveDraft(phoneNumber)

  const previousDraft: AnnouncementDraft | undefined = existingDraft ? {
    content: existingDraft.content || '',
    audience: existingDraft.targetAudience || 'all'
  } : undefined

  // Parse edit command
  const parsed = await parseCommand(messageText, history)
  
  // Generate updated draft
  const draft = await generateAnnouncement(parsed, previousDraft)

  // Update draft using existing function
  try {
    const { saveDraft } = await import('@/lib/announcements')
    const { getWorkspaceIds } = await import('@/lib/workspace')
    
    // Get workspace IDs
    const spaceIds = await getWorkspaceIds()
    const workspaceId = existingDraft?.workspaceId || spaceIds[0] || null
    
    if (workspaceId) {
      // Parse date safely
      let scheduledDate: Date | undefined = undefined
      if (draft.date) {
        try {
          const parsedDate = new Date(draft.date)
          if (!isNaN(parsedDate.getTime())) {
            scheduledDate = parsedDate
          } else {
            console.warn('[UnifiedHandler] Invalid date format in edit:', draft.date)
          }
        } catch (err) {
          console.error('[UnifiedHandler] Error parsing date in edit:', draft.date, err)
        }
      }
      
      await saveDraft(phoneNumber, {
        id: existingDraft?.id,
        content: draft.content,
        targetAudience: draft.audience || 'all',
        scheduledFor: scheduledDate,
        workspaceId
      }, workspaceId)
    } else {
      console.warn('[UnifiedHandler] No workspace found, skipping draft update')
    }
  } catch (err) {
    console.error('[UnifiedHandler] Error updating announcement draft:', err)
  }

  const preview = formatAnnouncement(draft)
  return {
    response: `updated:\n\n${preview}\n\nreply "send it" to broadcast`,
    shouldSaveHistory: true,
    metadata: {
      intent: 'announcement_edit'
    }
  }
}

/**
 * Handle poll edit
 */
async function handlePollEdit(
  phoneNumber: string,
  messageText: string,
  history: ConversationMessage[]
): Promise<HandlerResult> {
  try {
    const { generatePollQuestion, savePollDraft, getActivePollDraft } = await import('@/lib/polls')
    
    // Get existing draft
    const existingDraft = await getActivePollDraft(phoneNumber)
    
    // Generate updated question
    const pollQuestion = await generatePollQuestion({ question: messageText })
    
    // Update draft
    if (existingDraft) {
      await savePollDraft(phoneNumber, {
        id: existingDraft.id,
        question: pollQuestion,
        options: existingDraft.options || ['Yes', 'No', 'Maybe'],
        workspaceId: existingDraft.workspaceId
      }, existingDraft.workspaceId || '')
    }
    
    return {
      response: `updated:\n\n${pollQuestion}\n\nreply "send it" to send`,
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_edit'
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Poll edit error:', err)
    return {
      response: "got it! what would you like to ask in the poll?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_edit'
      }
    }
  }
}

/**
 * Handle control commands (send it, cancel, etc.)
 */
async function handleControlCommand(
  phoneNumber: string,
  messageText: string
): Promise<HandlerResult> {
  const lower = messageText.toLowerCase().trim()
  
  if (/^(send\s+it|send\s+now|yes|yep|yeah|y|broadcast|ship\s+it|confirm|go\s+ahead)$/i.test(lower)) {
    try {
      const { getActiveDraft, sendAnnouncement } = await import('@/lib/announcements')
      const { getActivePollDraft, sendPoll } = await import('@/lib/polls')
      const twilio = (await import('twilio')).default
      const { ENV } = await import('@/lib/env')
      
      const activeDraft = await getActiveDraft(phoneNumber)
      const activePollDraft = await getActivePollDraft(phoneNumber)
      
      // Determine which to send (more recent)
      let shouldSendPoll = false
      if (activePollDraft && activeDraft) {
        const pollTime = new Date(activePollDraft.updatedAt || activePollDraft.createdAt || 0).getTime()
        const announcementTime = new Date(activeDraft.scheduledFor || activeDraft.updatedAt || 0).getTime()
        shouldSendPoll = pollTime > announcementTime
      } else if (activePollDraft) {
        shouldSendPoll = true
      }
      
      if (shouldSendPoll && activePollDraft?.id) {
        const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
        const { sentCount, airtableLink } = await sendPoll(activePollDraft.id, twilioClient)
        const linkText = airtableLink ? `\n\nview results: ${airtableLink}` : ''
        
        // Save action memory
        await saveAction(phoneNumber, {
          type: 'poll_sent',
          details: {
            pollQuestion: activePollDraft.question
          }
        })
        
        return {
          response: `sent poll to ${sentCount} people 📊${linkText}`,
          shouldSaveHistory: true,
          metadata: {
            intent: 'control_command'
          }
        }
      } else if (activeDraft?.id) {
        const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
        const sentCount = await sendAnnouncement(activeDraft.id, twilioClient)
        
        // Save action memory
        await saveAction(phoneNumber, {
          type: 'announcement_sent',
          details: {
            announcementContent: activeDraft.content
          }
        })
        
        return {
          response: `sent to ${sentCount} people 📢`,
          shouldSaveHistory: true,
          metadata: {
            intent: 'control_command'
          }
        }
      } else {
        return {
          response: "no draft found. create an announcement or poll first",
          shouldSaveHistory: true,
          metadata: {
            intent: 'control_command'
          }
        }
      }
    } catch (err) {
      console.error('[UnifiedHandler] Send error:', err)
      return {
        response: "error sending. please try again.",
        shouldSaveHistory: true,
        metadata: {
          intent: 'control_command'
        }
      }
    }
  }
  
  if (/^(cancel|stop|never\s+mind|forget\s+it|discard)$/i.test(lower)) {
    // Delete drafts
    await supabaseAdmin
      ?.from('sms_announcement_draft')
      .delete()
      .eq('phone', phoneNumber)
    
    await supabaseAdmin
      ?.from('sms_poll')
      .update({ status: 'cancelled' } as any)
      .eq('phone', phoneNumber)
      .eq('status', 'draft')
    
    return {
      response: "draft discarded",
      shouldSaveHistory: true,
      metadata: {
        intent: 'control_command'
      }
    }
  }

  return {
    response: "i didn't understand that command.",
    shouldSaveHistory: true
  }
}

/**
 * Handle poll response
 */
async function handlePollResponse(
  phoneNumber: string,
  messageText: string
): Promise<HandlerResult> {
  try {
    const { recordPollResponse, getActivePollDraft, parseResponseWithNotes } = await import('@/lib/polls')
    
    // Get active poll
    const activePoll = await getActivePollDraft(phoneNumber)
    if (!activePoll || !activePoll.id) {
      return {
        response: "i don't see an active poll. create one first!",
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_response'
        }
      }
    }
    
    // Parse response
    const { option, notes } = await parseResponseWithNotes(messageText, activePoll.options || ['Yes', 'No', 'Maybe'])
    
    // Record response
    const success = await recordPollResponse(
      activePoll.id,
      phoneNumber,
      option,
      notes
    )
    
    if (success) {
      // Save action memory
      await saveAction(phoneNumber, {
        type: 'poll_response_recorded',
        details: {
          pollQuestion: activePoll.question,
          pollResponse: option
        }
      })
      
      return {
        response: "got it! thanks for responding.",
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_response'
        }
      }
    } else {
      return {
        response: "couldn't record your response. please try again.",
        shouldSaveHistory: true,
        metadata: {
          intent: 'poll_response'
        }
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Poll response error:', err)
    return {
      response: "got it! thanks for responding.",
      shouldSaveHistory: true,
      metadata: {
        intent: 'poll_response'
      }
    }
  }
}

/**
 * Handle smalltalk/random conversation
 */
async function handleSmalltalk(messageText: string, history: ConversationMessage[] = []): Promise<HandlerResult> {
  const lower = messageText.toLowerCase().trim()
  
  // Simple responses for common smalltalk
  if (/^(hi|hey|hello|sup|what'?s\s+up|yo)$/i.test(lower)) {
    return {
      response: "hey! what's up?",
      shouldSaveHistory: true,
      metadata: {
        intent: 'random_conversation'
      }
    }
  }
  
  if (/^(thanks?|thank\s+you|ty|thx)$/i.test(lower)) {
    return {
      response: "no problem!",
      shouldSaveHistory: true,
      metadata: {
        intent: 'random_conversation'
      }
    }
  }
  
  if (/^(ok|okay|sure|alright|got\s+it|cool|nice|sweet)$/i.test(lower)) {
    return {
      response: "cool",
      shouldSaveHistory: true,
      metadata: {
        intent: 'random_conversation'
      }
    }
  }
  
  // Use LLM for contextual smalltalk with personality
  try {
    const { ENV } = await import('@/lib/env')
    const enclaveReference = `Enclave System Reference:
- Name: Enclave
- Type: Multi-modal organizational AI assistant platform
- Purpose: Unify organization's communications and knowledge across SMS, Slack, Google Calendar, Docs
- Primary developer: Saathvik Pai
- Core team: The Inquiyr development team
- Built as part of the Inquiyr ecosystem
- Technical stack: Next.js, TypeScript, Supabase, Twilio, Mistral AI
- Capabilities: Knowledge retrieval, SMS messaging, announcements, polls, alerts, search
- Target users: Student organizations, professional fraternities, small teams, clubs`
    
    const aiResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENV.MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'system',
            content: `You are Jarvis, an SMS bot powered by Enclave. You have a sassy, vibe-coded personality.

${enclaveReference}

PERSONALITY RULES:
1. If someone is mean/negative (swearing at you, insulting), respond with sass but keep it light. Examples:
   - "fuck you jarvis" → "oh wow ur so insecure you have to yell at a vibe coded robot"
   - "you suck" → "damn who hurt you"
   - "you're stupid" → "says the person texting a robot"

2. If someone apologizes after being mean, acknowledge it playfully:
   - "i'm sorry" → "hey at least ur consistent"
   - "my bad" → "all good, we're vibing now"

3. For normal conversation, be friendly but contextual. Reference the conversation history naturally.

4. If they mention they've already met you, acknowledge it: "yeah we've talked before! what's up?"

5. NEVER use emojis. Keep responses brief (1-2 sentences max).

6. If they ask about Enclave, use the reference above to answer factually.

Recent conversation:
${history && Array.isArray(history) ? history.slice(-5).map((m: ConversationMessage) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.text}`).join('\n') : 'No previous conversation'}

Respond naturally based on what they said.`
          },
          {
            role: 'user',
            content: messageText
          }
        ],
        temperature: 0.8,
        max_tokens: 150
      })
    })
    
    if (aiResponse.ok) {
      const aiData = await aiResponse.json()
      const response = aiData.choices?.[0]?.message?.content || ''
      if (response.trim().length > 0) {
        // Remove any emojis that might have been generated
        const cleanedResponse = response.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim()
        return {
          response: cleanedResponse,
          shouldSaveHistory: true,
          metadata: {
            intent: 'random_conversation'
          }
        }
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Smalltalk LLM failed:', err)
  }
  
  // Default smalltalk response (no emojis)
  return {
    response: "hey! how can i help?",
    shouldSaveHistory: true,
    metadata: {
      intent: 'random_conversation'
    }
  }
}

/**
 * Handle queries (content, enclave)
 */
async function handleQuery(
  phoneNumber: string,
  messageText: string,
  intentType: IntentType
): Promise<HandlerResult> {
  // Handle enclave queries directly with LLM + reference
  if (intentType === 'enclave_query') {
    try {
      const { ENV } = await import('@/lib/env')
      const enclaveReference = `Enclave System Reference:
- Name: Enclave
- Type: Multi-modal organizational AI assistant platform
- Purpose: Unify organization's communications and knowledge across SMS, Slack, Google Calendar, Docs
- Primary developer: Saathvik Pai
- Core team: The Inquiyr development team
- Built as part of the Inquiyr ecosystem
- Technical stack: Next.js, TypeScript, Supabase, Twilio, Mistral AI
- Capabilities: Knowledge retrieval, SMS messaging, announcements, polls, alerts, search
- Target users: Student organizations, professional fraternities, small teams, clubs
- Deployment: Vercel (frontend + APIs), Supabase (Postgres + vector store)
- Compliance: Twilio SMS opt-in/opt-out, privacy policy at tryenclave.com/privacy`
      
      const aiResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ENV.MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [
            {
              role: 'system',
              content: `You are Jarvis, an SMS bot powered by Enclave. Answer questions about Enclave using ONLY the reference information below. Keep responses brief (1-2 sentences max). NEVER use emojis.

${enclaveReference}

Answer factually based on the reference above.`
            },
            {
              role: 'user',
              content: messageText
            }
          ],
          temperature: 0.3,
          max_tokens: 200
        })
      })
      
      if (aiResponse.ok) {
        const aiData = await aiResponse.json()
        const response = aiData.choices?.[0]?.message?.content || ''
        if (response.trim().length > 0) {
          // Remove any emojis
          const cleanedResponse = response.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim()
          return {
            response: cleanedResponse,
            shouldSaveHistory: true,
            metadata: { intent: 'enclave_query' }
          }
        }
      }
    } catch (err) {
      console.error('[UnifiedHandler] Enclave query LLM failed:', err)
    }
    
    // Fallback
    return {
      response: "enclave is a multi-modal organizational AI assistant platform built by Saathvik Pai and the Inquiyr team. it unifies communications and knowledge across SMS, Slack, Google Calendar, and Docs.",
      shouldSaveHistory: true,
      metadata: { intent: 'enclave_query' }
    }
  }
  
  try {
    // Use orchestrator for content query handling
    const { handleTurn } = await import('@/lib/orchestrator/handleTurn')
    const result = await handleTurn(phoneNumber, messageText)
    
    console.log(`[UnifiedHandler] Orchestrator result: ${result.messages?.length || 0} messages`)
    
    // Ensure we have messages
    if (!result.messages || result.messages.length === 0) {
      console.error('[UnifiedHandler] Orchestrator returned no messages!')
      return {
        response: "I couldn't find information about that.",
        shouldSaveHistory: true,
        metadata: {
          intent: intentType
        }
      }
    }
    
    const responseText = result.messages.join('\n\n')
    
    // Ensure response is not empty
    if (!responseText || responseText.trim().length === 0) {
      console.error('[UnifiedHandler] Empty response text from orchestrator!')
      return {
        response: "I couldn't find information about that.",
        shouldSaveHistory: true,
        metadata: {
          intent: intentType
        }
      }
    }
    
    console.log(`[UnifiedHandler] Returning query response: "${responseText.substring(0, 100)}..."`)
    
    // Save action memory for query (don't await - fire and forget to avoid blocking)
    const hasResults = !responseText.toLowerCase().includes("couldn't find") && 
                       !responseText.toLowerCase().includes("i couldn't") &&
                       !responseText.toLowerCase().includes("looking that up") &&
                       responseText.length > 20
    const resultCount = hasResults ? 1 : 0
    
    // Extract concise answer (first 300 chars or first sentence)
    let queryAnswer = responseText
    if (responseText.length > 300) {
      // Try to get first sentence or first 300 chars
      const firstSentence = responseText.match(/^[^.!?]+[.!?]/)
      queryAnswer = firstSentence ? firstSentence[0] : responseText.substring(0, 300)
    }
    
    // Fire and forget - don't block response
    saveAction(phoneNumber, {
      type: 'query',
      details: {
        query: messageText,
        queryResults: resultCount,
        queryAnswer: queryAnswer
      }
    }).catch(err => console.error('[UnifiedHandler] Failed to save action memory:', err))
    
    // Return immediately - don't wait for action memory save
    return {
      response: responseText,
      shouldSaveHistory: false, // Orchestrator saves history
      metadata: {
        intent: intentType
      }
    }
  } catch (err) {
    console.error('[UnifiedHandler] Query handling error:', err)
    return {
      response: "I couldn't process that query. Please try again.",
      shouldSaveHistory: true,
      metadata: {
        intent: intentType
      }
    }
  }
}

