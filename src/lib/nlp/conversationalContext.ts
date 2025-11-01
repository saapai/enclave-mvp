import { ENV } from '../env'

export type ConversationalContext = {
  contextType: 'announcement_input' | 'poll_input' | 'poll_response' | 'poll_draft_edit' | 'announcement_draft_edit' | 'general_query' | 'chat'
  confidence: number
  reasoning?: string
}

/**
 * Use LLM to classify conversational context based on current message + recent history
 * This replaces hardcoded string matching with intelligent context understanding
 */
export async function classifyConversationalContext(
  currentMessage: string,
  lastBotMessage: string,
  lastUserMessage: string,
  conversationHistory: Array<{user_message: string, bot_response: string}> = []
): Promise<ConversationalContext> {
  // Build conversation context for LLM
  const conversationContext = conversationHistory
    .slice(0, 3)
    .reverse() // Show in chronological order
    .map(msg => `Bot: ${msg.bot_response}\nUser: ${msg.user_message}`)
    .join('\n\n')

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
            content: `You are a conversational context classifier for an AI assistant. Classify what the user is doing in the conversation based on recent messages.

CRITICAL RULES:
1. Check the LAST bot message first - if bot asked a specific question, user's response is likely answering that question
2. "announcement_input" is ONLY for when bot explicitly asked "what would you like the announcement to say?" AND the current message is providing content (not asking a question!)
3. Questions like "What's happening?", "What's up?", "What's going on?" are ALWAYS general_query, NEVER announcement_input
4. "I wanna make an announcement" or "I want to make an announcement" is a NEW REQUEST, NOT input → classify as general_query
5. User saying "no it should say X" or "change it to X" after seeing a draft is announcement_draft_edit
6. If the current message contains a question mark (?), it's almost certainly NOT announcement_input

CONTEXT TYPES:
- announcement_input: User is providing content AFTER bot asked "what would you like the announcement to say?"
  Example: Bot: "what would you like the announcement to say?" User: "Quinn is bad at football" → announcement_input
  Counter-example: Bot: "Active meeting tonight" User: "I wanna make an announcement" → general_query (NOT announcement_input!)
- poll_input: User is providing a poll question AFTER bot asked "what would you like to ask in the poll?"
  Example: Bot: "what would you like to ask in the poll?" User: "Who's coming?" → poll_input
- poll_response: User is responding to a poll question with yes/no/option/code
  Example: Bot: "Are you coming? Reply YES or NO" User: "yes" → poll_response
- poll_draft_edit: User is editing an existing poll draft (e.g., "change it to X", "make it meaner", "no it should say X")
  Example: Bot: "here's what the poll will say: X. reply to edit" User: "make it meaner" → poll_draft_edit
  Example: Bot: "here's what the poll will say: X" User: "no it should say Y" → poll_draft_edit
- announcement_draft_edit: User is editing an existing announcement draft (e.g., "change it to X", "make it nicer", "no it should say X")
  Example: Bot: "here's what the announcement will say: X. reply to edit" User: "make it nicer" → announcement_draft_edit
  Example: Bot: "here's what the announcement will say: X" User: "no it should say Y" → announcement_draft_edit
- general_query: User is asking about events, policies, OR making a new request (like "I wanna make an announcement")
  Example: User: "when is active meeting?" → general_query
  Example: User: "What's happening?" → general_query (information query, NOT announcement input!)
  Example: User: "What's up?" → general_query
  Example: User: "I wanna make an announcement" → general_query (new request, not input!)
  CRITICAL: If the message is a QUESTION (contains "?", "what", "when", "where", "who", "how"), it's general_query, NOT announcement_input!
- chat: Casual conversation, greetings, or small talk (ONLY if no other context applies)
  Example: User: "hey" → chat

Return ONLY valid JSON:
{
  "contextType": "announcement_input|poll_input|poll_response|poll_draft_edit|announcement_draft_edit|general_query|chat",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`
          },
          {
            role: 'user',
            content: `${conversationContext}

Bot: ${lastBotMessage}
User: ${currentMessage}

Classify the context:`
          }
        ],
        temperature: 0.1,
        max_tokens: 200
      })
    })

    if (!response.ok) {
      console.error(`[Conversational Context] API error: ${response.status}`)
      return fallbackContextClassification(currentMessage, lastBotMessage, lastUserMessage)
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content

    if (!content) {
      console.error('[Conversational Context] No content in response')
      return fallbackContextClassification(currentMessage, lastBotMessage, lastUserMessage)
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[Conversational Context] No JSON found in response')
      return fallbackContextClassification(currentMessage, lastBotMessage, lastUserMessage)
    }

    const context: ConversationalContext = JSON.parse(jsonMatch[0])
    console.log(`[Conversational Context] Classified as: ${context.contextType}, confidence: ${context.confidence}`)
    
    return context

  } catch (error) {
    console.error('[Conversational Context] Error:', error)
    return fallbackContextClassification(currentMessage, lastBotMessage, lastUserMessage)
  }
}

/**
 * Fallback context classification using simple rules
 * Used when LLM is unavailable or fails
 */
function fallbackContextClassification(
  currentMessage: string,
  lastBotMessage: string,
  lastUserMessage: string
): ConversationalContext {
  const lowerCurrent = currentMessage.toLowerCase()
  const lowerLastBot = lastBotMessage.toLowerCase()

  // Check if bot asked for announcement input
  if (lowerLastBot.includes('what would you like the announcement to say') || 
      lowerLastBot.includes('what the announcement will say')) {
    return { contextType: 'announcement_input', confidence: 0.9 }
  }

  // Check if bot asked for poll input
  if (lowerLastBot.includes('what would you like to ask in the poll')) {
    return { contextType: 'poll_input', confidence: 0.9 }
  }

  // Check if editing draft
  if (lowerCurrent.includes('change it to') || lowerCurrent.includes('make it')) {
    if (lowerLastBot.includes('announcement')) {
      return { contextType: 'announcement_draft_edit', confidence: 0.8 }
    } else if (lowerLastBot.includes('poll')) {
      return { contextType: 'poll_draft_edit', confidence: 0.8 }
    }
  }

  // Check if looks like poll response
  if (/^\d{1,2}$/.test(currentMessage.trim()) || 
      ['yes', 'no', 'maybe', 'y', 'n'].includes(lowerCurrent.trim())) {
    return { contextType: 'poll_response', confidence: 0.7 }
  }

  // Default to general query
  return { contextType: 'general_query', confidence: 0.5 }
}

