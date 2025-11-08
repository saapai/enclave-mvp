/**
 * Context-Aware Intent Classifier
 * 
 * Uses weighted conversation history (last 5-10 messages) to understand
 * user intent with full conversational context.
 */

import { ENV } from '@/lib/env'

export type IntentType = 
  | 'content_query'      // Questions about documents, events, resources (needs async search)
  | 'simple_question'    // Simple questions answered immediately (name, greeting)
  | 'follow_up_query'    // Follow-up to previous queries
  | 'enclave_query'      // Questions about Enclave itself
  | 'random_conversation' // Casual chat, greetings, smalltalk
  | 'announcement_command' // Command to create/send announcement
  | 'poll_command'       // Command to create/send poll
  | 'poll_response'      // Response to an active poll
  | 'announcement_edit'  // Editing an existing announcement draft
  | 'poll_edit'          // Editing an existing poll draft
  | 'name_declaration'   // User declaring their name
  | 'control_command'    // send it, cancel, etc.

export interface ConversationMessage {
  role: 'user' | 'bot'
  text: string
  timestamp: string
}

export interface ClassifiedIntent {
  type: IntentType
  confidence: number
  reasoning?: string
  // For announcements/polls
  verbatimText?: string
  instructions?: string[]
  needsGeneration?: boolean
  // For edits
  editType?: 'replace' | 'append' | 'modify'
  fieldsToUpdate?: string[]
  // For follow-ups
  isFollowUp?: boolean
}

/**
 * Load conversation history with weighting
 * More recent messages have higher weight
 */
export async function loadWeightedHistory(
  phoneNumber: string,
  limit: number = 10
): Promise<ConversationMessage[]> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase')
    if (!supabaseAdmin) return []

    const { data } = await supabaseAdmin
      .from('sms_conversation_history')
      .select('id, user_message, bot_response, created_at')
      .eq('phone_number', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (!data) return []

    const messages: ConversationMessage[] = []
    for (const row of data.reverse()) {
      if (row.user_message) {
        messages.push({
          role: 'user',
          text: row.user_message,
          timestamp: row.created_at
        })
      }
      if (row.bot_response) {
        messages.push({
          role: 'bot',
          text: row.bot_response,
          timestamp: row.created_at
        })
      }
    }

    return messages
  } catch (err) {
    console.error('[ContextClassifier] Failed to load history:', err)
    return []
  }
}

/**
 * Classify intent using LLM with full conversation context
 */
export async function classifyIntent(
  currentMessage: string,
  history: ConversationMessage[] = []
): Promise<ClassifiedIntent> {
  // Build weighted context string with full conversation history
  const contextMessages = history.slice(-15) // Last 15 messages for better context
  const contextString = contextMessages.length > 0
    ? contextMessages
        .map((msg, idx) => {
          const weight = (idx + 1) / contextMessages.length // More recent = higher weight
          const role = msg.role === 'user' ? 'User' : 'Bot'
          return `[Weight: ${weight.toFixed(2)}] ${role}: ${msg.text}`
        })
        .join('\n')
    : 'No previous conversation'

  const fullContext = contextString 
    ? `Recent conversation:\n${contextString}\n\nCurrent message: "${currentMessage}"`
    : `Current message: "${currentMessage}"`

  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
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
            content: `You are an intelligent intent classifier for Jarvis, an SMS bot powered by Enclave. Your job is to understand EXACTLY what the user is saying based on FULL conversational context.

Analyze the conversation history carefully. Consider:
1. What the user just said
2. What was said before (recent messages)
3. What the bot said in response
4. Whether there are unanswered questions
5. Whether the user is referring to something from earlier in the conversation

Classify the user's CURRENT message into ONE of these intents:

INTENTS:
- content_query: Questions about documents, events, resources, policies that require searching the knowledge base (e.g., "when is big little", "what's happening this week", "when is active meeting"). These take time to process.
- simple_question: Simple questions that can be answered immediately without searching (e.g., "what's your name", "how are you", "who are you"). These should be answered synchronously.
- follow_up_query: User is asking about a previous query or action (e.g., "what's the answer", "did you find that", "answer my previous queries", "hello answer pls"). Check if there are recent queries in the conversation.
- enclave_query: Questions about Enclave itself (e.g., "what is enclave", "what can you do")
- random_conversation: Casual chat, greetings, smalltalk (e.g., "hey", "thanks", "what's up", "howre you doing")
- announcement_command: User wants to create/send an announcement (e.g., "send out a message", "make an announcement", "broadcast", "say that it's football tmr 6am")
- poll_command: User wants to create/send a poll (e.g., "make a poll", "create a poll", "send a poll")
- poll_response: User is responding to an active poll (e.g., "yes", "no", "option 1", "A")
- announcement_edit: User is editing an announcement draft - ONLY if there's an active draft AND they're clearly modifying it (e.g., "make it say X", "change the time to Y", "update it")
- poll_edit: User is editing a poll draft
- name_declaration: User is stating their name (e.g., "I'm John", "my name is Sarah", "call me Mike")
- control_command: Control commands (e.g., "send it", "cancel", "yes", "no")

CRITICAL RULES:
1. If the user asks "what's your name", "who are you", "how are you" → simple_question (NOT content_query)
2. If the user asks "what's the answer", "did you find", "answer my queries" → follow_up_query (check conversation for previous queries)
3. If the user says "answer my previous queries" or "answer pls" → follow_up_query (they want answers to earlier questions)
4. Questions about past actions (e.g., "why didn't you send", "did you find") → follow_up_query or content_query, NOT announcement_edit
5. Only classify as announcement_edit if there's clearly an active draft AND the user is modifying it
6. "Answer my previous queries" is NEVER announcement_edit - it's asking for answers to past questions
7. Consider the FULL conversation context - if the bot said "Looking that up..." recently, the user might be following up

For announcement/poll commands, also extract:
- verbatimText: Exact text the user wants to use (if they say "use my exact wording" or quote text)
- instructions: List of specific instructions (e.g., ["make sure to say it's at 9am", "mention the location"])
- needsGeneration: true if the bot should generate content, false if user provided exact text

Return ONLY valid JSON:
{
  "type": "intent_type",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why you chose this intent based on conversation context",
  "verbatimText": "exact text if provided",
  "instructions": ["instruction1", "instruction2"],
  "needsGeneration": true/false,
  "isFollowUp": true/false (if this is a follow-up to a previous query)
}`
          },
          {
            role: 'user',
            content: fullContext
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      })
    })

    if (!response.ok) {
      throw new Error(`Mistral API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const intentType = parsed.type || 'random_conversation'
      
      // Validate intent type
      const validIntents: IntentType[] = [
        'content_query', 'simple_question', 'follow_up_query', 'enclave_query',
        'random_conversation', 'announcement_command', 'poll_command', 'poll_response',
        'announcement_edit', 'poll_edit', 'name_declaration', 'control_command'
      ]
      
      const finalType = validIntents.includes(intentType as IntentType) 
        ? intentType as IntentType 
        : 'random_conversation'
      
      return {
        type: finalType,
        confidence: parsed.confidence || 0.5,
        reasoning: parsed.reasoning,
        verbatimText: parsed.verbatimText,
        instructions: parsed.instructions || [],
        needsGeneration: parsed.needsGeneration !== false, // Default to true
        isFollowUp: parsed.isFollowUp || false
      }
    }
  } catch (err) {
    console.error('[ContextClassifier] LLM classification failed:', err)
  }

  // Fallback to rule-based classification
  return fallbackClassify(currentMessage, history)
}

/**
 * Fallback rule-based classifier
 */
function fallbackClassify(
  message: string,
  history: ConversationMessage[]
): ClassifiedIntent {
  const lower = message.toLowerCase().trim()
  const lastBotMessage = history.filter(m => m.role === 'bot').pop()?.text || ''
  const lowerLastBot = lastBotMessage.toLowerCase()

  // Questions about past actions should NOT be announcement_edit
  if (/^why\s+(didn'?t|did\s+not|wasn'?t)/i.test(lower)) {
    return {
      type: 'random_conversation',
      confidence: 0.8,
      reasoning: 'Question about past action'
    }
  }
  
  if (/^(did\s+you|have\s+you|were\s+you)/i.test(lower)) {
    return {
      type: 'content_query',
      confidence: 0.7,
      reasoning: 'Question about past action'
    }
  }

  // Control commands
  if (/^(send\s+it|send\s+now|yes|yep|yeah|y|broadcast|ship\s+it|confirm|go\s+ahead|cancel|stop|never\s+mind|forget\s+it|discard|no|nope|edit|change|update)$/i.test(lower)) {
    return {
      type: 'control_command',
      confidence: 0.95
    }
  }

  // Name declaration patterns
  if (/^(i'?m|i\s+am|my\s+name\s+is|call\s+me|this\s+is)\s+[A-Za-z]+/i.test(message)) {
    return {
      type: 'name_declaration',
      confidence: 0.9
    }
  }

  // Announcement commands
  if (/\b(send|make|create|broadcast|blast)(?:\s+out)?(?:\s+an?\s+)?(?:message|announcement)\b/i.test(lower)) {
    return {
      type: 'announcement_command',
      confidence: 0.9,
      needsGeneration: true
    }
  }

  // Poll commands
  if (/\b(make|create|send)(?:\s+an?\s+)?(?:poll|survey)\b/i.test(lower)) {
    return {
      type: 'poll_command',
      confidence: 0.9,
      needsGeneration: true
    }
  }

  // Poll response (if last bot message was a poll)
  if (lowerLastBot.includes('poll') && (lower === 'yes' || lower === 'no' || lower === 'maybe' || /^\d+$/.test(lower))) {
    return {
      type: 'poll_response',
      confidence: 0.9
    }
  }

  // Announcement edit (if bot asked for announcement content)
  if (lowerLastBot.includes('what would you like the announcement to say')) {
    return {
      type: 'announcement_edit',
      confidence: 0.95,
      needsGeneration: false
    }
  }

  // Poll edit (if bot asked for poll question)
  if (lowerLastBot.includes('what would you like to ask in the poll')) {
    return {
      type: 'poll_edit',
      confidence: 0.95,
      needsGeneration: false
    }
  }

  // Questions
  if (message.includes('?') || /^(what|when|where|who|how|why|is|are|was|were|do|does|did|will|can|could|should)\s/i.test(message)) {
    // Check if it's about Enclave
    if (/\benclave\b/i.test(message)) {
      return {
        type: 'enclave_query',
        confidence: 0.8
      }
    }
    return {
      type: 'content_query',
      confidence: 0.7
    }
  }

  // Smalltalk
  if (/^(hi|hey|hello|sup|what'?s\s+up|yo|thanks?|thank\s+you|ty|thx|ok|okay|sure|alright|got\s+it|cool|nice|sweet)$/i.test(lower)) {
    return {
      type: 'random_conversation',
      confidence: 0.9
    }
  }

  // Default
  return {
    type: 'random_conversation',
    confidence: 0.5
  }
}

