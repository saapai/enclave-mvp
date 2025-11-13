/**
 * Smart Command Parser for Announcements and Polls
 * 
 * Understands what parts to include exactly (verbatim) vs what to generate,
 * and handles complex instructions like "use my exact wording" or "make sure to say it's at 9am"
 */

import { ENV } from '@/lib/env'

export interface ParsedCommand {
  verbatimText?: string
  instructions: string[]
  needsGeneration: boolean
  extractedFields: {
    content?: string
    time?: string
    date?: string
    location?: string
    audience?: string
    tone?: string
  }
  constraints: {
    mustInclude: string[]
    mustNotChange: string[]
    verbatimOnly: boolean
  }
}

/**
 * Parse announcement/poll command with LLM understanding
 */
export async function parseCommand(
  message: string,
  history: Array<{ role: 'user' | 'bot'; text: string }> = []
): Promise<ParsedCommand> {
  // Build context from recent messages
  const contextString = history
    .slice(-5)
    .map(msg => `${msg.role === 'user' ? 'User' : 'Bot'}: ${msg.text}`)
    .join('\n')

  const fullContext = contextString
    ? `Recent conversation:\n${contextString}\n\nCurrent message: "${message}"`
    : `Current message: "${message}"`

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
            content: `You are a command parser for Jarvis, an SMS bot that creates announcements and polls.

Parse the user's command and extract:
1. verbatimText: Exact text the user wants to use (if they say "use my exact wording", "send this exactly", "saying", or provide quoted text). For quoted text, extract the FULL content between the outermost quotes, including any nested quotes.
2. instructions: Specific instructions about what to include/modify (e.g., "make sure to say it's at 9am", "mention the location", "add that it's mandatory")
3. needsGeneration: true if bot should generate content, false if user provided exact text
4. extractedFields: Extract any explicit fields mentioned:
   - content: The main message content
   - time: Time mentioned (e.g., "9am", "at 6pm")
   - date: Date mentioned (e.g., "tomorrow", "Friday")
   - location: Location mentioned (e.g., "at the gym", "in room 101")
   - audience: Target audience (e.g., "actives", "pledges", "everyone")
   - tone: Tone requested (e.g., "casual", "urgent", "formal")
5. constraints:
   - mustInclude: Things that MUST be included in the final message
   - mustNotChange: Things that must NOT be changed from verbatim text
   - verbatimOnly: true if entire message should be verbatim

CRITICAL: When extracting quoted text, capture EVERYTHING between the outermost quotes, including nested quotes.

Examples:
- "send out a message: meeting at 9am" → needsGeneration: true, extractedFields: {content: "meeting", time: "9am"}
- "use my exact wording: meeting at 9am" → verbatimText: "meeting at 9am", verbatimOnly: true, needsGeneration: false
- "send a message about study hall, make sure to say it's at 9am" → needsGeneration: true, instructions: ["make sure to say it's at 9am"], extractedFields: {content: "study hall", time: "9am"}
- "broadcast this exactly: 'Active meeting tonight at 8pm'" → verbatimText: "Active meeting tonight at 8pm", verbatimOnly: true, needsGeneration: false
- "Send a poll saying "Meeting tonight at 8pm. Are you coming? Reply "yes" or "no"."" → verbatimText: "Meeting tonight at 8pm. Are you coming? Reply "yes" or "no".", verbatimOnly: true, needsGeneration: false

Return ONLY valid JSON:
{
  "verbatimText": "exact text if provided",
  "instructions": ["instruction1", "instruction2"],
  "needsGeneration": true/false,
  "extractedFields": {
    "content": "...",
    "time": "...",
    "date": "...",
    "location": "...",
    "audience": "...",
    "tone": "..."
  },
  "constraints": {
    "mustInclude": ["item1", "item2"],
    "mustNotChange": ["item1"],
    "verbatimOnly": true/false
  }
}`
          },
          {
            role: 'user',
            content: fullContext
          }
        ],
        temperature: 0.1,
        max_tokens: 800
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
      return {
        verbatimText: parsed.verbatimText,
        instructions: parsed.instructions || [],
        needsGeneration: parsed.needsGeneration !== false,
        extractedFields: parsed.extractedFields || {},
        constraints: {
          mustInclude: parsed.constraints?.mustInclude || [],
          mustNotChange: parsed.constraints?.mustNotChange || [],
          verbatimOnly: parsed.constraints?.verbatimOnly || false
        }
      }
    }
  } catch (err) {
    console.error('[SmartParser] LLM parsing failed:', err)
  }

  // Fallback to rule-based parsing
  return fallbackParse(message)
}

/**
 * Fallback rule-based parser
 */
function fallbackParse(message: string): ParsedCommand {
  const lower = message.toLowerCase()
  
  // Extract the outermost quoted text (handles nested quotes)
  let verbatimText: string | undefined
  
  // Look for pattern: saying "..." or poll, "..." or similar
  const sayingMatch = message.match(/(?:saying|poll,?|message,?|asking)\s+"(.+)"$/i)
  if (sayingMatch && sayingMatch[1]) {
    verbatimText = sayingMatch[1].trim()
  }
  
  // If not found, try to extract the last/longest quoted section
  if (!verbatimText) {
    // Find all quote positions
    const quotePositions: number[] = []
    for (let i = 0; i < message.length; i++) {
      if (message[i] === '"') {
        quotePositions.push(i)
      }
    }
    
    // If we have at least 2 quotes, extract content between first and last
    if (quotePositions.length >= 2) {
      const firstQuote = quotePositions[0]
      const lastQuote = quotePositions[quotePositions.length - 1]
      if (lastQuote > firstQuote) {
        verbatimText = message.substring(firstQuote + 1, lastQuote).trim()
      }
    }
  }
  
  // Check for verbatim indicators
  if (!verbatimText) {
    const verbatimPatterns = [
      /use\s+my\s+exact\s+wording[:\s]+(.+)/i,
      /send\s+this\s+exactly[:\s]+(.+)/i,
      /broadcast\s+this\s+exactly[:\s]+(.+)/i,
      /use\s+exact\s+text[:\s]+(.+)/i,
    ]

    for (const pattern of verbatimPatterns) {
      const match = message.match(pattern)
      if (match && match[1]) {
        verbatimText = match[1].trim()
        break
      }
    }
  }

  // Extract instructions
  const instructions: string[] = []
  const instructionPatterns = [
    /make\s+sure\s+to\s+say\s+(.+?)(?:\.|$)/gi,
    /make\s+sure\s+it\s+says?\s+(.+?)(?:\.|$)/gi,
    /don'?t\s+forget\s+to\s+(.+?)(?:\.|$)/gi,
    /include\s+(.+?)(?:\.|$)/gi,
  ]

  for (const pattern of instructionPatterns) {
    const matches = message.matchAll(pattern)
    for (const match of matches) {
      if (match[1]) {
        instructions.push(match[1].trim())
      }
    }
  }

  // Extract date (tomorrow, tmr, today, etc.)
  const lowerMessage = message.toLowerCase()
  let date: string | undefined
  const now = new Date()
  
  if (lowerMessage.includes('tmr') || lowerMessage.includes('tomorrow')) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    date = tomorrow.toISOString().split('T')[0] // YYYY-MM-DD format
  } else if (lowerMessage.includes('today')) {
    date = now.toISOString().split('T')[0]
  }
  
  // Extract time
  const timeMatch = message.match(/\b(\d{1,2}):?(\d{2})?\s*(am|pm)\b/i)
  let time: string | undefined
  if (timeMatch) {
    const hour = parseInt(timeMatch[1])
    const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0
    const ampm = timeMatch[3].toLowerCase()
    let hour24 = hour
    if (ampm === 'pm' && hour !== 12) hour24 += 12
    if (ampm === 'am' && hour === 12) hour24 = 0
    time = `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`
  }

  // Extract location
  const locationMatch = message.match(/\b(?:at|in)\s+(?:the\s+)?([A-Z][A-Za-z\s']+(?:apartment|house|room|building|hall|field|gym|SAC|court|lab)?)/)
  const location = locationMatch ? locationMatch[1].trim() : undefined

  // Extract audience
  let audience: string | undefined
  if (/\b(?:all|everyone|everybody)\b/i.test(message)) {
    audience = 'all'
  } else if (/\bactives?\b/i.test(message)) {
    audience = 'actives'
  } else if (/\bpledges?\b/i.test(message)) {
    audience = 'pledges'
  }

  // Extract content - look for "about X" or "X being" patterns
  let content = message
  const aboutMatch = message.match(/about\s+(.+?)(?:\s+being|\s+is|\s+at|\s+tmr|tomorrow|today|$)/i)
  if (aboutMatch && aboutMatch[1]) {
    content = aboutMatch[1].trim()
  } else {
    // Fallback: everything after colon if present, or main message
    const colonMatch = message.match(/:\s*(.+)$/i)
    if (colonMatch) {
      content = colonMatch[1].trim()
    }
  }
  
  // Clean up content - remove common phrases
  content = content.replace(/\b(being|is|at|tmr|tomorrow|today|morning|afternoon|evening)\b/gi, '').trim()

  return {
    verbatimText,
    instructions,
    needsGeneration: !verbatimText,
    extractedFields: {
      content: verbatimText || content,
      time,
      date,
      location,
      audience
    },
    constraints: {
      mustInclude: instructions,
      mustNotChange: verbatimText ? [verbatimText] : [],
      verbatimOnly: !!verbatimText
    }
  }
}

