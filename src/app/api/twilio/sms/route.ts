import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabase } from '@/lib/supabase'
import { searchResourcesHybrid } from '@/lib/search'
import { ENV } from '@/lib/env'

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

    // Check if user is opted in
    const { data: optInData } = await supabase
      .from('sms_optin')
      .select('*')
      .eq('phone', phoneNumber)
      .eq('opted_out', false)
      .single()

    if (!optInData) {
      console.log(`[Twilio SMS] User ${phoneNumber} not opted in, ignoring message`)
      return new NextResponse('User not opted in', { status: 200 })
    }

    // Handle commands: STOP, HELP
    const command = body?.trim().toUpperCase()
    
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

    if (command === 'HELP') {
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Message>Enclave SMS Help:\n\n• Text SEP followed by your question to search resources\n• Text STOP to opt out\n• Text HELP for this message\n\nReply STOP to unsubscribe.</Message></Response>',
        { 
          headers: { 'Content-Type': 'application/xml' }
        }
      )
    }

    // Check if this is the "SEP" keyword
    const upperBody = body?.trim().toUpperCase()
    if (upperBody === 'SEP') {
      // Start a query session
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
        '<Response><Message>Welcome to Enclave search! Type your question and I\'ll search through your resources.</Message></Response>',
        { 
          headers: { 'Content-Type': 'application/xml' }
        }
      )
    }

    // Check if user has an active query session
    const { data: activeSession } = await supabase
      .from('sms_query_session')
      .select('*')
      .eq('phone_number', phoneNumber)
      .eq('status', 'active')
      .single()

    if (!activeSession && upperBody !== 'SEP') {
      // No active session - prompt user to start with SEP
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Message>To start searching, text SEP followed by your question. Text HELP for help or STOP to unsubscribe.</Message></Response>',
        { 
          headers: { 'Content-Type': 'application/xml' }
        }
      )
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

    // Get user's workspaces from their phone number
    const { data: userData } = await supabase
      .from('app_user')
      .select('space_id')
      .eq('phone', phoneNumber)

    const spaceIds = userData?.map(u => u.space_id) || []
    
    // If no workspaces, use default space
    if (spaceIds.length === 0) {
      spaceIds.push('00000000-0000-0000-0000-000000000000')
    }

    console.log(`[Twilio SMS] Searching across ${spaceIds.length} workspaces for: "${query}"`)

    // Execute search
    const allResults = []
    for (const spaceId of spaceIds) {
      const results = await searchResourcesHybrid(
        query,
        spaceId,
        {},
        { limit: 3, offset: 0 },
        null // No specific userId for SMS searches
      )
      allResults.push(...results)
    }

    // Sort by relevance
    const sortedResults = allResults
      .sort((a, b) => (b.score || b.rank || 0) - (a.score || a.rank || 0))
      .slice(0, 3)

    console.log(`[Twilio SMS] Found ${sortedResults.length} results`)

    // Format response for SMS
    let responseMessage = ''
    
    if (sortedResults.length === 0) {
      responseMessage = 'No results found. Try a different search term.'
    } else {
      responseMessage = `Found ${sortedResults.length} result${sortedResults.length > 1 ? 's' : ''}:\n\n`
      
      sortedResults.forEach((result, index) => {
        responseMessage += `${index + 1}. ${result.title}\n`
        if (result.body && result.body.length > 100) {
          responseMessage += result.body.substring(0, 100) + '...\n'
        } else if (result.body) {
          responseMessage += result.body + '\n'
        }
        if (result.url) {
          responseMessage += `Link: ${result.url}\n`
        }
        responseMessage += '\n'
      })
    }

    // Add footer
    responseMessage += '---\nReply with another question or STOP to opt out.'

    // Truncate to SMS limits (1600 chars max for Twilio)
    if (responseMessage.length > 1600) {
      responseMessage = responseMessage.substring(0, 1600) + '...\n[Message truncated]'
    }

    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage}</Message>
</Response>`,
      { 
        headers: { 'Content-Type': 'application/xml' }
      }
    )

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

