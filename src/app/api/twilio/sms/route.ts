import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabase } from '@/lib/supabase'
import { searchResourcesHybrid } from '@/lib/search'
import { ENV } from '@/lib/env'

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

// Split long messages at sentence boundaries into multiple messages
const splitLongMessage = (message: string, maxLength: number = 1600): string[] => {
  if (message.length <= maxLength) {
    return [message]
  }
  
  const messages: string[] = []
  let remaining = message
  
  while (remaining.length > maxLength) {
    // Find the last sentence boundary within maxLength
    let splitPoint = maxLength
    const searchText = remaining.substring(0, maxLength)
    
    // Try to find sentence endings
    const lastPeriod = searchText.lastIndexOf('. ')
    const lastNewline = searchText.lastIndexOf('\n')
    const lastQuestion = searchText.lastIndexOf('? ')
    const lastExclamation = searchText.lastIndexOf('! ')
    
    // Use the latest sentence boundary
    const boundaries = [lastPeriod, lastNewline, lastQuestion, lastExclamation].filter(b => b > maxLength * 0.5) // Only use if reasonable length
    if (boundaries.length > 0) {
      splitPoint = Math.max(...boundaries) + 1
    }
    
    messages.push(remaining.substring(0, splitPoint).trim())
    remaining = remaining.substring(splitPoint).trim()
  }
  
  if (remaining.length > 0) {
    messages.push(remaining)
  }
  
  return messages
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

    // Normalize phone number
    const phoneNumber = from.replace('+', '')

    // Check if user exists in sms_optin table at ALL (not filtered by opted_out)
    const { data: optInDataAll, error: optInError } = await supabase
      .from('sms_optin')
      .select('*')
      .eq('phone', phoneNumber)
      .maybeSingle()

    // AUTO-OPT-IN: Check if user is opted in, if not, auto-opt them in with sassy message
    const { data: optInData } = await supabase
      .from('sms_optin')
      .select('*')
      .eq('phone', phoneNumber)
      .eq('opted_out', false)
      .single()

    // Handle commands: STOP, HELP first (before checking if new user)
    const command = body?.trim().toUpperCase()

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

    // Check if user is in sms_optin table to determine if they're truly new
    // Only send welcome if they're NOT in the table at all (first time ever)
    // Use optInDataAll which doesn't filter by opted_out
    const isTrulyNewUser = !optInDataAll
    let sassyWelcome = ''
    
    // Only show welcome for users who have NEVER opted in before (completely new phone number)
    if (isTrulyNewUser) {
      console.log(`[Twilio SMS] Brand new user ${phoneNumber}, sending welcome and opting in`)
      
      // Auto-opt in the user - use INSERT with ON CONFLICT to ensure it works
      const { error: insertError } = await supabase
        .from('sms_optin')
        .insert({
          phone: phoneNumber,
          name: phoneNumber,
          method: 'sms_auto',
          opted_out: false,
          consent_timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      
      // If insert failed due to existing record, ignore it
      if (insertError && insertError.code !== '23505') {
        console.error(`[Twilio SMS] Error inserting optin:`, insertError)
      }

      // Pick friendly welcome message (no emojis, no sarcasm)
      const sassyMessages = [
        "Hey! Welcome to Enclave. I'm your AI assistant - just text me questions and I'll search through your resources.",
        "Yo, welcome to Enclave! Ask me anything about your docs, events, or resources and I'll find it.",
        "Hey there! Enclave here - I can search through all your connected resources. What do you need?",
        "Welcome to Enclave! I can help you search across your documents, calendar, and more. What are you looking for?",
        "Hey! You're all set up with Enclave. Just ask me questions about your resources and I'll find what you need."
      ]
      sassyWelcome = sassyMessages[Math.floor(Math.random() * sassyMessages.length)]
      
      // Start query session for them
      await supabase
        .from('sms_query_session')
        .upsert({
          phone_number: phoneNumber,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
    }

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

    // Execute search
    const allResults = []
    for (const spaceId of spaceIds) {
      const results = await searchResourcesHybrid(
        query,
        spaceId,
        {},
        { limit: 5, offset: 0 },
        null // No specific userId for SMS searches
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

    // Generate natural summary from results - send ALL results to AI to choose best
    let summary = ''
    if (dedupedResults.length > 0) {
      // Build context with all top results
      const context = dedupedResults
        .slice(0, 3) // Top 3 results
        .map((result, idx) => {
          const body = result.body || ''
          const truncatedBody = body.length > 500 ? body.substring(0, 500) + '...' : body
          return `Title: ${result.title}\nContent: ${truncatedBody}`
        })
        .join('\n\n---\n\n')
      
      console.log(`[Twilio SMS] Sending ${dedupedResults.slice(0, 3).length} results to AI for best match`)
      console.log(`[Twilio SMS] Context length: ${context.length} chars`)
      console.log(`[Twilio SMS] Context preview: ${context.substring(0, 200)}...`)
      
      // ALWAYS use AI to extract ONLY relevant info from the documents for the query
      // AI will choose which documents are most relevant
      try {
        const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
        console.log(`[Twilio SMS] Calling AI API at: ${aiUrl}`)
        
        const aiRes = await fetch(aiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            context: context.length > 2000 ? context.substring(0, 2000) + '...' : context, // Send up to 2000 chars
            type: 'summary'
          })
        })
        
        console.log(`[Twilio SMS] AI API response status: ${aiRes.status}`)
        
        if (aiRes.ok) {
          const aiData = await aiRes.json()
          console.log(`[Twilio SMS] AI API response data:`, JSON.stringify(aiData).substring(0, 200))
          summary = aiData.response || dedupedResults[0].body || dedupedResults[0].title
          console.log('[Twilio SMS] AI generated summary from multiple results')
        } else {
          const errorText = await aiRes.text()
          console.error(`[Twilio SMS] AI API error response:`, errorText.substring(0, 300))
          // Fallback: use top result
          const topResult = dedupedResults[0]
          summary = topResult.body || topResult.title
          console.log('[Twilio SMS] Using fallback summary from top result')
        }
      } catch (err) {
        console.error('[Twilio SMS] AI summary failed with exception:', err)
        // Fallback: use top result
        const topResult = dedupedResults[0]
        summary = topResult.body || topResult.title
        console.log('[Twilio SMS] Using fallback summary after exception')
      }
      
      console.log('[Twilio SMS] Generated summary:', summary.substring(0, 100))
    }

    // Format response for SMS
    let responseMessage = ''
    
    // Add welcome ONLY for brand new users who just opted in (isTrulyNewUser = true and sassyWelcome was set)
    // This ensures welcome is ONLY sent on the FIRST message ever from a phone number
    if (isTrulyNewUser && sassyWelcome) {
      responseMessage = `${sassyWelcome}\n\n`
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

