import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ENV } from '@/lib/env'
import { ensureAirtableUser } from '@/lib/airtable'
import twilio from 'twilio'

export const dynamic = 'force-dynamic'

const PHONE_DIGITS_ONLY = /^\d{10}$/

function normalizeToE164(phone: string): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }
  if (PHONE_DIGITS_ONLY.test(digits)) {
    return `+1${digits}`
  }
  return null
}

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
    // Strategy: Get users from BOTH sms_optin AND sms_conversation_history
    // to catch users who have conversations but aren't in sms_optin
    
    // 1. Get all active users from sms_optin
    const { data: allActiveUsers, error: optinError } = await supabaseAdmin
      .from('sms_optin')
      .select('phone, name, needs_name, opted_out')
      .eq('opted_out', false) // Only active users
      .order('created_at', { ascending: false })
    
    if (optinError) {
      console.error(`[Retroactive Name Sync] Error querying sms_optin:`, optinError)
      return NextResponse.json(
        { error: 'Failed to query sms_optin', details: optinError },
        { status: 500 }
      )
    }
    
    // 2. Get all unique phone numbers from conversation history (users who texted but might not be in sms_optin)
    const { data: conversationPhones, error: convError } = await supabaseAdmin
      .from('sms_conversation_history')
      .select('phone_number')
      .order('created_at', { ascending: false })
    
    if (convError) {
      console.error(`[Retroactive Name Sync] Error querying conversation history:`, convError)
    }
    
    // 3. Build a map of all users (from sms_optin + conversation history)
    const userMap = new Map<string, { phone: string; name: string | null; needs_name: boolean | null; opted_out: boolean }>()
    
    // Add users from sms_optin
    for (const user of (allActiveUsers || [])) {
      userMap.set(user.phone, {
        phone: user.phone,
        name: user.name,
        needs_name: user.needs_name,
        opted_out: user.opted_out || false
      })
    }
    
    // Add users from conversation history who aren't in sms_optin
    const uniqueConvPhones = new Set((conversationPhones || []).map((c: any) => c.phone_number))
    for (const phone of uniqueConvPhones) {
      if (!userMap.has(phone)) {
        // Normalize phone (remove +1 prefix for consistency)
        const normalizedPhone = phone.startsWith('+1') ? phone.substring(2) : phone.replace(/[^\d]/g, '')
        if (!userMap.has(normalizedPhone)) {
          userMap.set(normalizedPhone, {
            phone: normalizedPhone,
            name: null,
            needs_name: true, // Assume they need name if not in sms_optin
            opted_out: false
          })
          console.log(`[Retroactive Name Sync] Found user in conversation history but not in sms_optin: ${normalizedPhone}`)
        }
      }
    }
    
    // 4. Filter users who need names
    // A user needs a name if:
    // - needs_name is true, OR
    // - name is null/empty, OR
    // - name equals phone number (not a real name)
    const usersNeedingNames = Array.from(userMap.values()).filter(user => {
      if (user.opted_out) return false // Skip opted out users
      
      const needsNameFlag = user.needs_name === true
      const nameIsNull = !user.name || user.name === null
      const nameIsEmpty = user.name && user.name.trim().length === 0
      const nameIsPhone = user.name && (
        user.name === user.phone || 
        user.name === `+1${user.phone}` ||
        user.name === user.phone.replace(/^\+1/, '') ||
        user.name.replace(/[^\d]/g, '') === user.phone.replace(/[^\d]/g, '')
      )
      
      const needsName = needsNameFlag || nameIsNull || nameIsEmpty || nameIsPhone
      
      if (needsName) {
        console.log(`[Retroactive Name Sync] User ${user.phone} needs name: needs_name=${user.needs_name}, name="${user.name || 'null'}", nameIsPhone=${nameIsPhone}`)
      }
      
      return needsName
    })
    
    console.log(`[Retroactive Name Sync] Total active users: ${allActiveUsers?.length || 0}`)
    console.log(`[Retroactive Name Sync] Found ${usersNeedingNames.length} users needing names`)
    
    if (usersNeedingNames.length === 0) {
      return NextResponse.json({
        message: 'No users found who need names',
        totalActive: allActiveUsers?.length || 0,
        count: 0,
        dryRun
      })
    }
    
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
      // Check if name is actually just the phone number (not a real name)
      const nameIsPhone = user.name && (
        user.name === user.phone || 
        user.name === `+1${user.phone}` ||
        user.name === user.phone.replace(/^\+1/, '') ||
        user.name.replace(/[^\d]/g, '') === user.phone.replace(/[^\d]/g, '')
      )
      const needsName = user.needs_name === true || !user.name || user.name.trim().length === 0 || nameIsPhone
      
      console.log(`[Retroactive Name Sync] Processing user: phone=${phone}, needs_name=${user.needs_name}, name="${user.name || 'null'}", nameIsPhone=${nameIsPhone}`)
      
      const detail: typeof results.details[0] = {
        phone,
        needs_name: user.needs_name,
        name: user.name,
        airtableSynced: false,
        messageSent: false
      }
      
      // 0. Ensure user exists in sms_optin (if they were only in conversation history)
      const userInOptin = allActiveUsers?.find(u => u.phone === phone)
      if (!userInOptin) {
        console.log(`[Retroactive Name Sync] User ${phone} not in sms_optin, adding them`)
        const { error: insertError } = await supabaseAdmin
          .from('sms_optin')
          .insert({
            phone: phone,
            name: null,
            method: 'sms_keyword', // Must be 'web_form' or 'sms_keyword' per database constraint
            keyword: 'SEP',
            opted_out: false,
            needs_name: true,
            consent_timestamp: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
        
        if (insertError) {
          if (insertError.code === '23505') {
            console.log(`[Retroactive Name Sync] User ${phone} already exists in sms_optin (duplicate key)`)
          } else {
            console.error(`[Retroactive Name Sync] Error adding user to sms_optin:`, JSON.stringify(insertError, null, 2))
          }
        } else {
          console.log(`[Retroactive Name Sync] ✓ Added user ${phone} to sms_optin`)
        }
      }
      
      // 1. Ensure user exists in Airtable
      if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
        try {
          const phoneE164 = normalizeToE164(phone)
          
          if (!phoneE164) {
            detail.airtableError = 'Invalid phone format'
            results.airtableErrors++
            console.warn(`[Retroactive Name Sync] Skipping Airtable sync for ${phone} - invalid format`)
          } else {
            console.log(`[Retroactive Name Sync] Ensuring Airtable user: phone=${phoneE164}`)
            const airtableResult = await ensureAirtableUser(
              ENV.AIRTABLE_BASE_ID,
              ENV.AIRTABLE_TABLE_NAME,
              phoneE164,
              undefined // Don't set name yet - we'll ask for it
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
            
            const phoneE164 = normalizeToE164(phone)
            if (!phoneE164) {
              detail.messageError = 'Invalid phone format'
              results.messageErrors++
              console.warn(`[Retroactive Name Sync] Skipping SMS for ${phone} - invalid format`)
              continue
            }
            
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

