import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client with service role key for admin operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { phone } = body

    // Validate required fields
    if (!phone) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    // Validate phone format (should be E.164 format: +1XXXXXXXXXX)
    const phoneRegex = /^\+1\d{10}$/
    if (!phoneRegex.test(phone)) {
      return NextResponse.json(
        { error: 'Phone number must be in E.164 format (+1XXXXXXXXXX)' },
        { status: 400 }
      )
    }

    // Check if phone number exists in opt-in records
    const { data: existingOptin, error: checkError } = await supabase
      .from('sms_optin')
      .select('*')
      .eq('phone', phone)
      .single()

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking existing opt-in:', checkError)
      return NextResponse.json(
        { error: 'Database error', details: checkError.message },
        { status: 500 }
      )
    }

    if (!existingOptin) {
      return NextResponse.json({
        success: true,
        message: 'Phone number is not in our system',
      })
    }

    // If already opted out, return success
    if (existingOptin.opted_out) {
      return NextResponse.json({
        success: true,
        message: 'Phone number is already opted out',
        alreadyOptedOut: true,
      })
    }

    // Opt out the user
    const { error: updateError } = await supabase
      .from('sms_optin')
      .update({
        opted_out: true,
        opted_out_timestamp: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phone)

    if (updateError) {
      console.error('Error opting out:', updateError)
      return NextResponse.json(
        { error: 'Failed to opt out', details: updateError.message },
        { status: 500 }
      )
    }

    // TODO: Send opt-out confirmation SMS via Twilio
    // Example confirmation message:
    // "[Enclave/Entrenched Coils] You have been unsubscribed. You will no longer receive messages from us. 
    // Reply START to resubscribe."

    return NextResponse.json({
      success: true,
      message: 'Successfully opted out of SMS notifications',
    })
  } catch (error) {
    console.error('Error processing SMS opt-out:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}




