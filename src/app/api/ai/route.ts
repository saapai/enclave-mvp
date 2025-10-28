import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { ENV } from '@/lib/env'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    const isDev = process.env.NODE_ENV !== 'production'
    if (!userId && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
      systemPrompt = `You are a helpful AI assistant that provides ONLY the specific information requested by the user.

CRITICAL RULES:
1. The context may contain multiple documents separated by "---"
2. Analyze the user's query carefully and find ONLY the information that directly answers their question
3. If the user asks "when is X", provide ONLY the date/time for X, nothing else
4. If the user asks "what is X", provide ONLY the definition/purpose of X
5. DO NOT include information about other topics, events, or details not asked for
6. Keep responses under 100 words - be extremely concise and direct
7. If no relevant information exists, say "No information found"`

      userPrompt = `Context: ${safeContext}\n\nQuery: ${safeQuery || 'Summarize the context above.'}\n\nAnswer ONLY the specific question asked. Extract ONLY the relevant information that directly answers the query. Ignore all other unrelated information in the context.`
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
        max_tokens: 500,
        temperature: 0.7,
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
