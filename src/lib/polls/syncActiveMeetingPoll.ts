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
 * Looks for poll with exact text: "can you make it to active meeting at 8 tomorrow (Wed) at Ash's apartment"
 */
async function findActiveMeetingPoll(): Promise<{ id: string; question: string; sent_at: string; options: string[] } | null> {
  try {
    // Search for polls with keywords related to active meeting
    // The exact text is: "can you make it to active meeting at 8 tomorrow (Wed) at Ash's apartment"
    const keywords = ['active', 'meeting', 'ash', '8', 'tomorrow']
    
    const { data: polls, error } = await supabaseAdmin
      .from('sms_poll')
      .select('id, question, sent_at, options, status')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(100) // Check more polls
    
    if (error || !polls) {
      console.error('[Active Meeting Sync] Error fetching polls:', error)
      return null
    }
    
    // Score polls by keyword match and exact text match
    const scoredPolls = polls.map(poll => {
      const questionLower = poll.question.toLowerCase()
      let score = 0
      
      // Check for exact phrase matches (higher weight)
      if (questionLower.includes('can you make it') && questionLower.includes('active meeting')) {
        score += 10
      }
      if (questionLower.includes('ash') && (questionLower.includes("'s") || questionLower.includes('s '))) {
        score += 5
      }
      if (questionLower.includes('8') && (questionLower.includes('tomorrow') || questionLower.includes('wed'))) {
        score += 5
      }
      
      // Check for individual keywords
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
    
    const bestMatch = scoredPolls.find(sp => sp.score >= 3) // Need at least 3 keywords or exact match
    if (bestMatch) {
      console.log(`[Active Meeting Sync] Found poll: ${bestMatch.poll.id} - "${bestMatch.poll.question}" (score: ${bestMatch.score})`)
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
 * Get user's response after poll was sent by searching conversation history
 * Looks for messages after the poll was sent and uses Mistral to determine if it's a poll response
 */
async function getUserResponseAfterPoll(
  phoneNumber: string,
  pollSentAt: string,
  pollId: string,
  pollOptions: string[]
): Promise<{ text: string; timestamp: string; option?: string; notes?: string } | null> {
  try {
    const normalizedPhone = normalizePhone(phoneNumber)
    const phoneE164 = toE164(normalizedPhone)
    
    // Add buffer (10 seconds) to ensure we only get messages after the poll was delivered
    const pollTime = new Date(pollSentAt)
    const minTime = new Date(pollTime.getTime() + 10000) // 10 seconds after poll sent
    
    // Get conversation history STRICTLY after poll was sent
    const { data: messages, error } = await supabaseAdmin
      .from('sms_conversation_history')
      .select('user_message, bot_response, created_at')
      .eq('phone_number', normalizedPhone)
      .gt('created_at', minTime.toISOString()) // STRICTLY greater than
      .order('created_at', { ascending: true })
      .limit(20) // Check first 20 messages after poll
    
    if (error || !messages || messages.length === 0) {
      return null
    }
    
    // Look through messages and use Mistral to determine if any are poll responses
    for (const msg of messages) {
      const userMsg = msg.user_message?.trim()
      if (!userMsg || userMsg.length === 0) continue
      
      // Verify message timestamp is after poll
      const msgTime = new Date(msg.created_at)
      if (msgTime <= pollTime) {
        continue
      }
      
      // Skip if it's clearly a query or command
      const lowerMsg = userMsg.toLowerCase()
      const isQuery = (
        lowerMsg.startsWith('when') ||
        lowerMsg.startsWith('what') ||
        lowerMsg.startsWith('where') ||
        lowerMsg.startsWith('who') ||
        lowerMsg.startsWith('how') ||
        lowerMsg.startsWith('why') ||
        lowerMsg.includes('?') ||
        lowerMsg.includes('make') ||
        lowerMsg.includes('create') ||
        lowerMsg.includes('send') ||
        lowerMsg.includes('delete') ||
        lowerMsg.includes('cancel') ||
        lowerMsg.length > 200
      )
      
      if (isQuery) {
        continue
      }
      
      // Use Mistral to parse if this is a poll response
      try {
        const parsed = await parseResponseWithNotes(userMsg, pollOptions)
        
        if (parsed.option && parsed.option.trim().length > 0) {
          // Verify the parsed option is actually one of the poll options
          const validOption = pollOptions.some(opt => 
            opt.toLowerCase() === parsed.option.toLowerCase()
          )
          
          if (validOption) {
            console.log(`[Active Meeting Sync] Found response for ${phoneNumber}: "${userMsg}" → ${parsed.option} (at ${msg.created_at})`)
            return {
              text: userMsg,
              timestamp: msg.created_at,
              option: parsed.option,
              notes: parsed.notes
            }
          }
        }
      } catch (parseError) {
        // If parsing fails, continue to next message
        continue
      }
    }
    
    // No valid response found
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
        
        // Get user's response after poll was sent (searches conversation history)
        const userResponse = await getUserResponseAfterPoll(phoneE164, poll.sent_at, poll.id, poll.options)
        
        if (!userResponse || !userResponse.option) {
          skipped++
          console.log(`[Active Meeting Sync] No valid response found for ${user.phone} after poll was sent`)
          continue
        }
        
        console.log(`[Active Meeting Sync] User ${user.phone} responded: "${userResponse.text}" → ${userResponse.option}`)
        
        // Prepare Airtable fields
        const personFieldName = ENV.AIRTABLE_PERSON_FIELD || 'Person'
        const airtableFields: Record<string, any> = {
          [personFieldName]: user.name || 'Unknown',
          [fields.questionField]: poll.question,
          [fields.responseField]: userResponse.option,
        }
        
        if (userResponse.notes) {
          airtableFields[fields.notesField] = userResponse.notes
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

