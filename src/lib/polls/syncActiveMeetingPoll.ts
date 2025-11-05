/**
 * Sync Active Meeting Poll Responses
 * 
 * Finds the poll about "active meeting at ash's", checks all opted-in users,
 * and syncs their responses to new Airtable fields using Mistral to parse responses.
 */

import { supabaseAdmin } from '../supabase'
import { ENV } from '../env'
import { createAirtableFields, upsertAirtableRecord } from '../airtable'
import { parseResponseWithNotes } from '../polls'

function normalizePhone(phone: string): string {
  const cleaned = String(phone).replace(/[^\d]/g, '')
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    return cleaned.substring(1)
  }
  return cleaned.slice(-10)
}

function toE164(normalized: string): string {
  if (normalized.length === 10) {
    return `+1${normalized}`
  }
  return normalized.startsWith('+') ? normalized : `+${normalized}`
}

/**
 * Find poll about active meeting at ash's
 */
async function findActiveMeetingPoll(): Promise<{ id: string; question: string; sent_at: string; options: string[] } | null> {
  try {
    // Search for polls with keywords related to active meeting
    const keywords = ['active', 'meeting', 'ash']
    
    const { data: polls, error } = await supabaseAdmin
      .from('sms_poll')
      .select('id, question, sent_at, options, status')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(50)
    
    if (error || !polls) {
      console.error('[Active Meeting Sync] Error fetching polls:', error)
      return null
    }
    
    // Score polls by keyword match
    const scoredPolls = polls.map(poll => {
      const questionLower = poll.question.toLowerCase()
      let score = 0
      for (const keyword of keywords) {
        if (questionLower.includes(keyword)) {
          score++
        }
      }
      return { poll, score }
    })
    
    // Sort by score (highest first), then by sent_at
    scoredPolls.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return new Date(b.poll.sent_at || 0).getTime() - new Date(a.poll.sent_at || 0).getTime()
    })
    
    const bestMatch = scoredPolls.find(sp => sp.score >= 2) // Need at least 2 keywords
    if (bestMatch) {
      console.log(`[Active Meeting Sync] Found poll: ${bestMatch.poll.id} - "${bestMatch.poll.question}"`)
      return {
        id: bestMatch.poll.id,
        question: bestMatch.poll.question,
        sent_at: bestMatch.poll.sent_at || '',
        options: (bestMatch.poll.options as string[]) || ['Yes', 'No', 'Maybe']
      }
    }
    
    console.error('[Active Meeting Sync] No poll found matching active meeting keywords')
    return null
  } catch (err) {
    console.error('[Active Meeting Sync] Error finding poll:', err)
    return null
  }
}

/**
 * Create new Airtable fields for active meeting poll
 */
async function createActiveMeetingFields(): Promise<{
  questionField: string
  responseField: string
  notesField: string
  fieldsCreated: boolean
}> {
  const fieldPrefix = 'active_meeting_at_ash'
  const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '_')
  
  const questionField = `${fieldPrefix}_Question_${timestamp}`
  const responseField = `${fieldPrefix}_Response_${timestamp}`
  const notesField = `${fieldPrefix}_Notes_${timestamp}`
  
  if (!ENV.AIRTABLE_TABLE_ID || !ENV.AIRTABLE_API_KEY || !ENV.AIRTABLE_BASE_ID) {
    console.warn('[Active Meeting Sync] Airtable not configured')
    return { questionField, responseField, notesField, fieldsCreated: false }
  }
  
  try {
    const result = await createAirtableFields(
      ENV.AIRTABLE_BASE_ID,
      ENV.AIRTABLE_TABLE_ID,
      {
        question: questionField,
        response: responseField,
        notes: notesField
      },
      ENV.AIRTABLE_API_KEY
    )
    
    const allFieldsExist = (result.created.length + result.existing.length) === 3
    
    return {
      questionField,
      responseField,
      notesField,
      fieldsCreated: allFieldsExist
    }
  } catch (err) {
    console.error('[Active Meeting Sync] Error creating fields:', err)
    return { questionField, responseField, notesField, fieldsCreated: false }
  }
}

/**
 * Get user's response after poll was sent
 */
async function getUserResponseAfterPoll(
  phoneNumber: string,
  pollSentAt: string
): Promise<{ text: string; timestamp: string } | null> {
  try {
    const normalizedPhone = normalizePhone(phoneNumber)
    
    // Get conversation history after poll was sent
    const { data: messages, error } = await supabaseAdmin
      .from('sms_conversation_history')
      .select('user_message, bot_response, created_at')
      .eq('phone_number', normalizedPhone)
      .gte('created_at', pollSentAt)
      .order('created_at', { ascending: true })
    
    if (error || !messages || messages.length === 0) {
      return null
    }
    
    // Find the first user message after poll was sent
    // Skip if it's clearly not a poll response (e.g., a query)
    for (const msg of messages) {
      const userMsg = msg.user_message?.trim()
      if (!userMsg) continue
      
      // Skip if it's clearly a query or command
      const lowerMsg = userMsg.toLowerCase()
      if (
        lowerMsg.startsWith('when') ||
        lowerMsg.startsWith('what') ||
        lowerMsg.startsWith('where') ||
        lowerMsg.startsWith('who') ||
        lowerMsg.startsWith('how') ||
        lowerMsg.includes('?') ||
        lowerMsg.includes('make') ||
        lowerMsg.includes('create') ||
        lowerMsg.includes('send')
      ) {
        continue
      }
      
      // This might be a poll response
      return {
        text: userMsg,
        timestamp: msg.created_at
      }
    }
    
    return null
  } catch (err) {
    console.error(`[Active Meeting Sync] Error getting response for ${phoneNumber}:`, err)
    return null
  }
}

/**
 * Sync active meeting poll responses for all opted-in users
 */
export async function syncActiveMeetingPollResponses(): Promise<{
  synced: number
  skipped: number
  errors: number
  errorsList: Array<{ phone: string; error: string }>
}> {
  let synced = 0
  let skipped = 0
  let errors = 0
  const errorsList: Array<{ phone: string; error: string }> = []
  
  try {
    // Step 1: Find the poll
    const poll = await findActiveMeetingPoll()
    if (!poll) {
      return { synced: 0, skipped: 0, errors: 1, errorsList: [{ phone: 'unknown', error: 'Poll not found' }] }
    }
    
    console.log(`[Active Meeting Sync] Found poll: "${poll.question}" (sent at: ${poll.sent_at})`)
    
    // Step 2: Create Airtable fields
    console.log(`[Active Meeting Sync] Creating Airtable fields...`)
    const fields = await createActiveMeetingFields()
    if (!fields.fieldsCreated) {
      console.error(`[Active Meeting Sync] ⚠️ Fields were not created. Continuing anyway...`)
    }
    
    // Step 3: Get all opted-in users
    const { data: optedInUsers, error: usersError } = await supabaseAdmin
      .from('sms_optin')
      .select('phone, name')
      .eq('opted_out', false)
    
    if (usersError || !optedInUsers) {
      console.error('[Active Meeting Sync] Error fetching opted-in users:', usersError)
      return { synced: 0, skipped: 0, errors: 1, errorsList: [{ phone: 'unknown', error: usersError?.message || 'Failed to fetch users' }] }
    }
    
    console.log(`[Active Meeting Sync] Found ${optedInUsers.length} opted-in users`)
    
    // Step 4: For each user, check if they responded
    for (const user of optedInUsers) {
      try {
        const phoneE164 = toE164(user.phone)
        
        // Get user's response after poll was sent
        const userResponse = await getUserResponseAfterPoll(phoneE164, poll.sent_at)
        
        if (!userResponse) {
          skipped++
          continue
        }
        
        console.log(`[Active Meeting Sync] User ${user.phone} responded: "${userResponse.text.substring(0, 50)}..."`)
        
        // Parse response using Mistral (via parseResponseWithNotes)
        const parsed = await parseResponseWithNotes(userResponse.text, poll.options)
        
        if (!parsed.option) {
          console.log(`[Active Meeting Sync] Could not parse response for ${user.phone}, skipping`)
          skipped++
          continue
        }
        
        // Prepare Airtable fields
        const personFieldName = ENV.AIRTABLE_PERSON_FIELD || 'Person'
        const airtableFields: Record<string, any> = {
          [personFieldName]: user.name || 'Unknown',
          [fields.questionField]: poll.question,
          [fields.responseField]: parsed.option,
        }
        
        if (parsed.notes) {
          airtableFields[fields.notesField] = parsed.notes
        }
        
        // Upsert to Airtable
        const result = await upsertAirtableRecord(
          ENV.AIRTABLE_BASE_ID!,
          ENV.AIRTABLE_TABLE_NAME!,
          phoneE164,
          airtableFields
        )
        
        if (result.ok) {
          synced++
          console.log(`[Active Meeting Sync] ✓ Synced ${user.phone} (${user.name || 'Unknown'}): ${parsed.option}${parsed.notes ? ` (${parsed.notes})` : ''}`)
        } else {
          errors++
          const errorMsg = result.error || 'Unknown error'
          errorsList.push({ phone: user.phone, error: errorMsg })
          console.error(`[Active Meeting Sync] ✗ Failed to sync ${user.phone}:`, errorMsg)
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (err) {
        errors++
        const errorMsg = err instanceof Error ? err.message : String(err)
        errorsList.push({ phone: user.phone, error: errorMsg })
        console.error(`[Active Meeting Sync] Error processing ${user.phone}:`, err)
      }
    }
    
    console.log(`[Active Meeting Sync] Completed: ${synced} synced, ${skipped} skipped, ${errors} errors`)
    return { synced, skipped, errors, errorsList }
  } catch (err) {
    console.error('[Active Meeting Sync] Fatal error:', err)
    return { synced: 0, skipped: 0, errors: 1, errorsList: [{ phone: 'unknown', error: err instanceof Error ? err.message : String(err) }] }
  }
}

