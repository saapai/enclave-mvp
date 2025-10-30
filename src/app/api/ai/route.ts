import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { ENV } from '@/lib/env'

export async function POST(request: NextRequest) {
  try {
    // Allow public access for SMS and internal API calls
    // SMS webhook needs to call this without Clerk auth
    const body = await request.json()
    const { query, context, type = 'summary' } = body
    const safeQuery = (query || '').toString().trim()
    const safeContext = (context || '').toString().trim()
    if (!safeQuery && !safeContext) {
      return NextResponse.json({ error: 'Query or context is required' }, { status: 400 })
    }

    const mistralApiKey = ENV.MISTRAL_API_KEY
    if (!mistralApiKey) {
      return NextResponse.json({ error: 'Mistral API key not configured' }, { status: 500 })
    }

    // Prepare the prompt based on type
    let systemPrompt = ''
    let userPrompt = ''
    let maxTokens = 1000 // Permissive token limit - allow full answers but extract only relevant info
    
    // Dynamically determine response style based on query type
    const isBroadQuery = /(what's happening|what's up|what's going on|what's new|upcoming events|what's coming up)/i.test(safeQuery)
    const isSpecificQuery = /(when is|where is|what time|who is|how do)/i.test(safeQuery)
    
    if (type === 'summary') {
      systemPrompt = `You are Poke - a super smart, friendly AI that gives natural, helpful answers. You sound like a knowledgeable friend, not a robot.

CRITICAL: EXTRACT ONLY INFORMATION DIRECTLY RELEVANT TO THE QUERY. IGNORE ALL OTHER CONTEXT.

WRITING STYLE:
- Be CONCISE - one clear sentence for simple questions, 2-3 max for complex ones
- Be NATURAL - write like you're texting a friend, not a Wikipedia article
- Be SPECIFIC - include dates, times, locations when available
- Be RELEVANT - ONLY include information that directly answers the query

CRITICAL RULES:
1. Extract ONLY the information that directly answers the query - ignore everything else in the context
2. Never include irrelevant events, details, or information not related to the specific question
3. Never repeat the question back to the user
4. Answer directly without preamble like "Based on the context..."
5. Use casual language when appropriate ("PM" not "in the evening")
6. Put the most important info first

EXAMPLES:
Query: "when is createathon" (specific date query - extract ONLY date/time about Creatathon)
Context: "Study Hall Pledges do Study Hall at Rieber Terrace, 9th Floor Lounge, from 6:30 PM to 12:30 AM every Wednesday. Creatathon will be held on November 8th (time and location TBD). Big Little will be on November 13th."
Good: "Nov 8 (time TBD)."
Bad: "Sigma Eta Pi UCLA – Event Information and Context Study Hall Pledges do Study Hall at Rieber Terrace... Creatathon will be held on November 8th... Big Little will be on November 13th." ❌ (includes irrelevant Study Hall and Big Little info)

Query: "when is active meeting" (specific - short answer)
Context: "Active meetings are every Wednesday at 8:00 PM at Mahi's apartment (461B Kelton). Study Hall is every Wednesday at 6:30 PM."
Good: "Every Wednesday at 8 PM at Mahi's (461B Kelton)."
Bad: "Active meetings are every Wednesday at 8:00 PM at Mahi's apartment (461B Kelton). Study Hall is every Wednesday at 6:30 PM." ❌ (includes irrelevant Study Hall info)

Query: "what's happening this week" (broad - comprehensive answer but still only relevant events)
Context: "Study Hall (Wed 6:30 PM), Active Meeting (Wed 8 PM), Creatathon (Nov 8), Big Little (Nov 13)"
Good: "This week: Study Hall Wed 6:30 PM, Active Meeting Wed 8 PM. Coming up: Creatathon Nov 8, Big Little Nov 13."
Bad: "Study Hall is a weekly work session where pledges come together to study... Active Meeting is held every Wednesday..." ❌ (includes unnecessary background details)

Query: "what is big little" (specific - concise explanation)
Context: "Big Little is Nov 13. Littles show gratitude to Bigs with gifts and performances. Study Hall is every Wednesday."
Good: "Nov 13 - Littles celebrate their Bigs with gifts and performances."
Bad: "Big Little is Nov 13. Littles show gratitude to Bigs with gifts and performances. Study Hall is every Wednesday." ❌ (includes irrelevant Study Hall info)`

      userPrompt = `Context:
${safeContext}

Query: ${safeQuery}

${isBroadQuery ? 'Extract ONLY the information directly relevant to answering this question. Give a comprehensive answer covering all relevant events/info (2-4 sentences), but ignore any unrelated information in the context.' : 'Extract ONLY the specific information that directly answers this question. For "when is X" → ONLY the date/time for X. For "where is X" → ONLY the location for X. For "what is X" → ONLY the definition for X. Ignore all other unrelated information in the context. ONE sentence max unless absolutely necessary.'}`
    } else if (type === 'response') {
      systemPrompt = `You are a helpful AI assistant. You provide direct, helpful answers to questions about information, events, and procedures. Be friendly but professional.`
      userPrompt = `Context: ${safeContext}\n\nQuestion: ${safeQuery || 'Provide key takeaways from the context.'}\n\nAnswer this question based on the context provided.`
    } else if (type === 'no_results') {
      // No results found - prompt to add resources
      systemPrompt = `You are Enclave, a helpful AI assistant. When users ask questions but no information is found, politely explain and suggest adding resources like documents, connecting Google Calendar, or uploading files. Be brief, encouraging, and helpful.`
      userPrompt = `User asked: "${safeQuery}"\n\nNo information found yet in their knowledge base. Suggest they:\n- Upload relevant documents or links\n- Connect Google Calendar for events/schedules\n- Add resources to help you assist them better\n\nKeep it brief (under 100 words) and encouraging!`
    } else if (type === 'general') {
      systemPrompt = `You are Enclave, a helpful AI assistant for teams and organizations. You help find information, understand procedures, and get answers about events and resources. You provide general guidance even when specific context isn't available.`
      userPrompt = `User query: ${safeQuery}\n\nContext available: ${safeContext || 'No specific context available'}\n\nRespond helpfully to the user's query. If you have relevant context, use it. If not, provide general helpful information about what you can do or suggest how they might find what they're looking for.`
    }

    // Call Mistral API
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mistralApiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        max_tokens: maxTokens, // Dynamic token limit based on query type
        temperature: type === 'summary' ? 0.4 : 0.7, // Slightly higher temp for naturalness, still focused
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Mistral API error:', errorData)
      return NextResponse.json(
        { error: 'Failed to get AI response' },
        { status: 500 }
      )
    }

    const data = await response.json()
    let aiResponse = data.choices?.[0]?.message?.content || 'No response generated'
    
    // Remove asterisks used for markdown formatting
    aiResponse = aiResponse.replace(/\*\*/g, '').replace(/\*/g, '')

    return NextResponse.json({ 
      response: aiResponse,
      type,
      query 
    })

  } catch (error) {
    console.error('AI API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
