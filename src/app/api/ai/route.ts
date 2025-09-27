import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { ENV } from '@/lib/env'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    // For testing, allow requests without authentication
    const _testUserId = userId || '00000000-0000-0000-0000-000000000000'

    const body = await request.json()
    const { query, context, type = 'summary' } = body

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const mistralApiKey = ENV.MISTRAL_API_KEY
    if (!mistralApiKey) {
      return NextResponse.json({ error: 'Mistral API key not configured' }, { status: 500 })
    }

    // Prepare the prompt based on type
    let systemPrompt = ''
    let userPrompt = ''

    if (type === 'summary') {
      systemPrompt = `You are a helpful assistant for a fraternity/sorority chapter. You provide concise, accurate summaries of information based on the context provided. Keep responses under 200 words and focus on the most important details.`
      userPrompt = `Context: ${context}\n\nQuery: ${query}\n\nProvide a helpful summary or answer based on the context above.`
    } else if (type === 'response') {
      systemPrompt = `You are a helpful assistant for a fraternity/sorority chapter. You provide direct, helpful answers to questions about chapter information, events, and procedures. Be friendly but professional.`
      userPrompt = `Context: ${context}\n\nQuestion: ${query}\n\nAnswer this question based on the context provided.`
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
    const aiResponse = data.choices?.[0]?.message?.content || 'No response generated'

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
