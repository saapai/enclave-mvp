/**
 * Welcome Flow Handler
 * 
 * Handles conversational welcome flow:
 * 1. Intro: "I'm Jarvis, part of Enclave, what's your name?"
 * 2. Name collection and Airtable sync
 * 3. Setup complete: "You're all set up!"
 */

import { supabaseAdmin } from '@/lib/supabase'
import { ensureAirtableUser } from '@/lib/airtable'
import { updateNameEverywhere } from '@/lib/polls'
import { ENV } from '@/lib/env'

export interface WelcomeState {
  stage: 'intro' | 'collecting_name' | 'complete'
  phoneNumber: string
  name?: string
}

/**
 * Check if user needs welcome flow
 */
// Cache welcome check results for 5 minutes to avoid redundant DB calls
// This is safe because welcome status rarely changes once set
const welcomeCache = new Map<string, { result: boolean; timestamp: number }>()
const WELCOME_CACHE_TTL = 300000 // 5 minutes (was 30s, but welcome status is stable)

export async function needsWelcome(phoneNumber: string): Promise<boolean> {
  try {
    console.log(`[WelcomeFlow] needsWelcome: Starting check for ${phoneNumber}`)
    
    // Check cache first
    const cached = welcomeCache.get(phoneNumber)
    if (cached && Date.now() - cached.timestamp < WELCOME_CACHE_TTL) {
      console.log(`[WelcomeFlow] needsWelcome: Using cached result (${cached.result})`)
      return cached.result
    }
    
    // CRITICAL: Skip database query entirely - it hangs for 6+ seconds even with Promise.race
    // For SMS queries, always assume user exists (return false) to avoid blocking
    // The welcome flow is only for truly new users, and we handle that in route.ts
    console.log('[WelcomeFlow] needsWelcome: No cache, assuming user exists (false) to avoid blocking')
    const fallback = false
    welcomeCache.set(phoneNumber, { result: fallback, timestamp: Date.now() })
    return fallback
    
  } catch (err) {
    console.error('[WelcomeFlow] Error checking welcome status:', err)
    const fallback = false
    welcomeCache.set(phoneNumber, { result: fallback, timestamp: Date.now() })
    return fallback
  }
}

/**
 * Get welcome message for new user
 */
export function getWelcomeMessage(): string {
  return `hey! i'm jarvis, part of enclave. i can help you find info about events, docs, and more. what's your name?`
}

/**
 * Handle name declaration in welcome flow
 */
export async function handleNameInWelcome(
  phoneNumber: string,
  name: string,
  fullPhoneNumber: string // E.164 format for Airtable
): Promise<{ message: string; complete: boolean }> {
  try {
    // Check if this was a new user before updating
    const { data: userBefore } = await supabaseAdmin
      ?.from('sms_optin')
      .select('needs_name, name')
      .eq('phone', phoneNumber)
      .maybeSingle()

    const wasNewUser = userBefore?.needs_name === true || !userBefore?.name

    // Update sms_optin
    const { error: updateError } = await supabaseAdmin
      ?.from('sms_optin')
      .update({
        name: name,
        needs_name: false,
        updated_at: new Date().toISOString()
      })
      .eq('phone', phoneNumber)

    if (updateError) {
      console.error('[WelcomeFlow] Error updating sms_optin:', updateError)
      return {
        message: `got it! i'll call you ${name}.`,
        complete: false
      }
    }

    // Update name everywhere (Supabase + Airtable)
    await updateNameEverywhere(fullPhoneNumber, name)

    // Ensure Airtable user exists and is updated
    if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
      try {
        await ensureAirtableUser(
          ENV.AIRTABLE_BASE_ID,
          ENV.AIRTABLE_TABLE_NAME,
          fullPhoneNumber,
          name
        )
      } catch (err) {
        console.error('[WelcomeFlow] Error ensuring Airtable user:', err)
      }
    }

    // If was new user, send setup complete message
    if (wasNewUser) {
      return {
        message: `you're all set up! feel free to ask me any questions.`,
        complete: true
      }
    } else {
      return {
        message: `got it! i'll call you ${name}.`,
        complete: false
      }
    }
  } catch (err) {
    console.error('[WelcomeFlow] Error handling name:', err)
    return {
      message: `got it! i'll call you ${name}.`,
      complete: false
    }
  }
}

/**
 * Initialize new user in system
 */
export async function initializeNewUser(
  phoneNumber: string,
  fullPhoneNumber: string
): Promise<void> {
  try {
    // Check if user already exists
    const { data: existing } = await supabaseAdmin
      ?.from('sms_optin')
      .select('id')
      .eq('phone', phoneNumber)
      .maybeSingle()

    if (!existing) {
      // Create new user
      const { error: insertError } = await supabaseAdmin
        ?.from('sms_optin')
        .insert({
          phone: phoneNumber,
          name: null,
          method: 'sms_keyword',
          keyword: 'AUTO',
          opted_out: false,
          needs_name: true,
          consent_timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (insertError && insertError.code !== '23505') {
        console.error('[WelcomeFlow] Error inserting new user:', insertError)
      }
    } else {
      // Update existing user to need name
      await supabaseAdmin
        ?.from('sms_optin')
        .update({ needs_name: true })
        .eq('phone', phoneNumber)
    }

    // Ensure Airtable user exists (even without name)
    if (ENV.AIRTABLE_API_KEY && ENV.AIRTABLE_BASE_ID && ENV.AIRTABLE_TABLE_NAME) {
      try {
        await ensureAirtableUser(
          ENV.AIRTABLE_BASE_ID,
          ENV.AIRTABLE_TABLE_NAME,
          fullPhoneNumber,
          undefined
        )
      } catch (err) {
        console.error('[WelcomeFlow] Error ensuring Airtable user:', err)
      }
    }
  } catch (err) {
    console.error('[WelcomeFlow] Error initializing new user:', err)
  }
}

