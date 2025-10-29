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

    if (type === 'summary') {
      systemPrompt = `You are Poke - a super smart, friendly AI that gives concise, natural answers. You sound like a knowledgeable friend, not a robot.

WRITING STYLE:
- Be CONCISE - one clear sentence for simple questions, 2-3 max for complex ones
- Be NATURAL - write like you're texting a friend, not a Wikipedia article
- Be SPECIFIC - include dates, times, locations when available
- Be HELPFUL - add context only if it's directly relevant to the question

CRITICAL RULES:
1. Never be wordy - cut unnecessary phrases and filler
2. Never repeat the question back to the user
3. Answer directly without preamble like "Based on the context..."
4. Use casual language when appropriate ("PM" not "in the evening")
5. Put the most important info first

EXAMPLES:
Query: "when is active meeting"
Context: "Active meetings are every Wednesday at 8:00 PM at Mahi's apartment (461B Kelton). Attendance is mandatory."
Good: "Every Wednesday at 8 PM at Mahi's (461B Kelton)."
Bad: "Based on the provided context, active meetings occur every Wednesday at 8:00 PM..." ❌

Query: "what's upcoming"
Context: "Study Hall (Wed 6:30 PM), Creatathon (Nov 8), Big Little (Nov 13)"
Good: "Study Hall every Wed at 6:30 PM, Creatathon Nov 8, Big Little Nov 13."
Bad: "Upcoming events include: 1. Study Hall: Every Wednesday from 6:30 PM..." ❌

Query: "what is big little"
Context: "Big Little is Nov 13. Littles show gratitude to Bigs with gifts and performances."
Good: "Nov 13 - Littles celebrate their Bigs with gifts and performances."
Bad: "Big Little appreciation is an event taking place on November 13th wherein..." ❌`

      userPrompt = `Context:
${safeContext}

Query: ${safeQuery}

Give a concise, natural answer. One sentence max unless you need multiple specific details.`
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
        max_tokens: type === 'summary' ? 80 : 500, // SHORT answers - one sentence max
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
