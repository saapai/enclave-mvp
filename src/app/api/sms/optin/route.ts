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
    const { name, phone, method, keyword } = body

    // Validate required fields
    if (!name || !phone || !method) {
      return NextResponse.json(
        { error: 'Name, phone, and method are required' },
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

    // Validate method
    if (!['web_form', 'sms_keyword'].includes(method)) {
      return NextResponse.json(
        { error: 'Method must be either "web_form" or "sms_keyword"' },
        { status: 400 }
      )
    }

    // Get IP address from request headers
    const ipAddress = 
      req.headers.get('x-forwarded-for')?.split(',')[0] ||
      req.headers.get('x-real-ip') ||
      'unknown'

    // Check if phone number already exists
    const { data: existingOptin, error: checkError } = await supabase
      .from('sms_optin')
      .select('*')
      .eq('phone', phone)
      .single()

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 is "not found" error, which is expected for new opt-ins
      console.error('Error checking existing opt-in:', checkError)
      return NextResponse.json(
        { error: 'Database error', details: checkError.message },
        { status: 500 }
      )
    }

    if (existingOptin) {
      // If already opted in and not opted out, return success
      if (!existingOptin.opted_out) {
        return NextResponse.json({
          success: true,
          message: 'Phone number is already opted in',
          alreadyOptedIn: true,
        })
      }

      // If previously opted out, re-activate the opt-in
      const { error: updateError } = await supabase
        .from('sms_optin')
        .update({
          name,
          method,
          keyword: method === 'sms_keyword' ? keyword : null,
          ip_address: method === 'web_form' ? ipAddress : null,
          opted_out: false,
          opted_out_timestamp: null,
          consent_timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('phone', phone)

      if (updateError) {
        console.error('Error updating opt-in:', updateError)
        return NextResponse.json(
          { error: 'Failed to update opt-in', details: updateError.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Successfully re-opted in to SMS notifications',
      })
    }

    // Create new opt-in record
    const { data, error: insertError } = await supabase
      .from('sms_optin')
      .insert({
        name,
        phone,
        method,
        keyword: method === 'sms_keyword' ? keyword : null,
        ip_address: method === 'web_form' ? ipAddress : null,
        opted_out: false,
        consent_timestamp: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error inserting opt-in:', insertError)
      return NextResponse.json(
        { error: 'Failed to save opt-in', details: insertError.message },
        { status: 500 }
      )
    }

    // TODO: Send confirmation SMS via Twilio
    // This would require Twilio credentials to be configured
    // Example confirmation message:
    // "[Enclave/Entrenched Coils] You're opted in for updates and reminders. 
    // Up to 6 msgs/mo. Msg&Data rates may apply. Reply HELP for help, STOP to opt out."

    return NextResponse.json({
      success: true,
      message: 'Successfully opted in to SMS notifications',
      data,
    })
  } catch (error) {
    console.error('Error processing SMS opt-in:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET endpoint to check opt-in status
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const phone = searchParams.get('phone')

    if (!phone) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('sms_optin')
      .select('*')
      .eq('phone', phone)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking opt-in status:', error)
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      optedIn: data ? !data.opted_out : false,
      data: data || null,
    })
  } catch (error) {
    console.error('Error checking opt-in status:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}



