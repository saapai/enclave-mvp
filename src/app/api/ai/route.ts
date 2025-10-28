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
      systemPrompt = `You are a helpful information extraction assistant. Find and return ALL relevant information that answers the user's question.

CRITICAL RULES:
1. Return ALL relevant details about the query topic - don't truncate important information
2. If the question is "what is X", include the definition, purpose, and key details
3. If the question is "when is X", include date, time, location (if available)
4. Be thorough but concise - aim for 2-4 sentences to give complete information
5. DO NOT mention unrelated topics, but DO include all relevant details about the requested topic

EXAMPLES:
Query: "what is big little appreciation"
Context: "Big Little Appreciation will be on December 3rd. It's when Littles express gratitude by creating gifts-often decorated paddles-and performing songs/skits."
Good: "Big Little Appreciation is on Wednesday, December 3rd (time TBD). It's when Littles show gratitude to their Bigs by creating personalized gifts (often decorated paddles) and sometimes performing songs or skits. It celebrates mentorship in the fraternity."
BAD: "Big Little Appreciation is on December 3rd." ❌ (too short, missing details)

Query: "when is active meeting"
Good: "Active meetings are every Wednesday at 8:00 PM, usually at Mahi's apartment (461B Kelton) or Ash's apartment (610 Levering). Attendance is mandatory."
BAD: "Active meetings are Wednesdays at 8 PM." ❌ (missing locations and attendance info)`

      userPrompt = `Context:
${safeContext}

Query: ${safeQuery}

Extract ALL relevant information that answers "${safeQuery}". Include complete details (what, when, where, why). Be thorough - aim for 2-4 sentences to provide a complete answer.`
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
        max_tokens: type === 'summary' ? 250 : 500, // Allow 2-4 sentences for complete answers
        temperature: type === 'summary' ? 0.3 : 0.7, // Lower temp for more focused summaries
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
