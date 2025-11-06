import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ENV } from '@/lib/env'
import { ensureAirtableUser } from '@/lib/airtable'
import twilio from 'twilio'

export const dynamic = 'force-dynamic'

/**
 * Retroactively sync users who slipped through and proactively ask for their names
 * 
 * This endpoint:
 * 1. Finds all users in sms_optin who need names (needs_name=true OR no name)
 * 2. Ensures they exist in Airtable
 * 3. Sends them a proactive message asking for their name
 * 
 * Usage:
 * GET /api/admin/retroactive-name-sync?dryRun=true (preview mode)
 * GET /api/admin/retroactive-name-sync (actually send messages)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const dryRun = searchParams.get('dryRun') === 'true'
    
    console.log(`[Retroactive Name Sync] Starting ${dryRun ? 'DRY RUN' : 'LIVE'} mode`)
    
    // Find all users who need names
    const { data: usersNeedingNames, error: queryError } = await supabaseAdmin
      .from('sms_optin')
      .select('phone, name, needs_name, opted_out')
      .eq('opted_out', false) // Only active users
      .or('needs_name.eq.true,name.is.null')
      .order('created_at', { ascending: false })
    
    if (queryError) {
      console.error(`[Retroactive Name Sync] Error querying users:`, queryError)
      return NextResponse.json(
        { error: 'Failed to query users', details: queryError },
        { status: 500 }
      )
    }
    
    if (!usersNeedingNames || usersNeedingNames.length === 0) {
      return NextResponse.json({
        message: 'No users found who need names',
        count: 0,
        dryRun
      })
    }
    
    console.log(`[Retroactive Name Sync] Found ${usersNeedingNames.length} users needing names`)
    
    const results = {
      total: usersNeedingNames.length,
      airtableSynced: 0,
      airtableErrors: 0,
      messagesSent: 0,
      messageErrors: 0,
      skipped: 0,
      details: [] as Array<{
        phone: string
        needs_name: boolean | null
        name: string | null
        airtableSynced: boolean
        airtableError?: string
        messageSent: boolean
        messageError?: string
      }>
    }
    
    // Initialize Twilio client
    const twilioClient = dryRun ? null : twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)
    
    // Process each user
    for (const user of usersNeedingNames) {
      const phone = user.phone
      const needsName = user.needs_name === true || !user.name || user.name.trim().length === 0
      
      console.log(`[Retroactive Name Sync] Processing user: phone=${phone}, needs_name=${user.needs_name}, name="${user.name || 'null'}"`)
      
      const detail: typeof results.details[0] = {
        phone,
        needs_name: user.needs_name,
        name: user.name,
        airtableSynced: false,
        messageSent: false
      }
      
      // 1. Ensure user exists in Airtable
      if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
        try {
          // Convert phone to E.164 format for Airtable
          const phoneE164 = phone.startsWith('+1') ? phone : `+1${phone}`
          
          console.log(`[Retroactive Name Sync] Ensuring Airtable user: phone=${phoneE164}`)
          const airtableResult = await ensureAirtableUser(
            ENV.AIRTABLE_BASE_ID,
            ENV.AIRTABLE_TABLE_NAME,
            phoneE164,
            user.name || undefined // Use existing name if available
          )
          
          if (airtableResult.ok) {
            detail.airtableSynced = true
            results.airtableSynced++
            console.log(`[Retroactive Name Sync] ✓ Airtable synced for ${phone}`)
          } else {
            detail.airtableError = airtableResult.error || 'Unknown error'
            results.airtableErrors++
            console.error(`[Retroactive Name Sync] ✗ Airtable sync failed for ${phone}: ${airtableResult.error}`)
          }
        } catch (err) {
          detail.airtableError = err instanceof Error ? err.message : String(err)
          results.airtableErrors++
          console.error(`[Retroactive Name Sync] ✗ Exception syncing Airtable for ${phone}:`, err)
        }
      } else {
        console.warn(`[Retroactive Name Sync] Skipping Airtable sync - missing config`)
        detail.airtableError = 'Airtable not configured'
      }
      
      // 2. Send proactive message asking for name (only if they truly need it)
      if (needsName) {
        const message = `hey! i'm jarvis, powered by enclave. i can help you find info about events, docs, and more. what's your name?`
        
        if (dryRun) {
          console.log(`[Retroactive Name Sync] [DRY RUN] Would send to ${phone}: "${message}"`)
          detail.messageSent = true // Mark as would-send in dry run
          results.messagesSent++
        } else {
          try {
            if (!twilioClient) {
              throw new Error('Twilio client not initialized')
            }
            
            // Convert phone to E.164 format for Twilio
            const phoneE164 = phone.startsWith('+1') ? phone : `+1${phone}`
            
            console.log(`[Retroactive Name Sync] Sending message to ${phoneE164}`)
            const messageResult = await twilioClient.messages.create({
              body: message,
              from: ENV.TWILIO_PHONE_NUMBER,
              to: phoneE164
            })
            
            detail.messageSent = true
            results.messagesSent++
            console.log(`[Retroactive Name Sync] ✓ Message sent to ${phone} (SID: ${messageResult.sid})`)
            
            // Save to conversation history
            await supabaseAdmin.from('sms_conversation_history').insert({
              phone_number: phone,
              user_message: null, // Proactive message, no user message
              bot_response: message
            })
            console.log(`[Retroactive Name Sync] ✓ Saved conversation history for ${phone}`)
          } catch (err) {
            detail.messageError = err instanceof Error ? err.message : String(err)
            results.messageErrors++
            console.error(`[Retroactive Name Sync] ✗ Failed to send message to ${phone}:`, err)
          }
        }
      } else {
        console.log(`[Retroactive Name Sync] Skipping message for ${phone} - already has name`)
        results.skipped++
      }
      
      results.details.push(detail)
    }
    
    console.log(`[Retroactive Name Sync] Completed: ${JSON.stringify(results, null, 2)}`)
    
    return NextResponse.json({
      message: dryRun ? 'Dry run completed' : 'Retroactive sync completed',
      dryRun,
      results
    })
  } catch (error) {
    console.error(`[Retroactive Name Sync] Fatal error:`, error)
    return NextResponse.json(
      {
        error: 'Retroactive sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

