/**
 * Retroactive Poll Response Sync
 * 
 * Syncs all existing poll responses to Airtable with the correct field names
 */

import { supabaseAdmin } from '../supabase'
import { ENV } from '../env'
import { upsertAirtableRecord } from '../airtable'
import { createAirtableFieldsForPoll } from '../polls'

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
 * Sync all poll responses for a specific poll to Airtable
 */
export async function syncPollResponsesToAirtable(pollId: string): Promise<{
  synced: number
  errors: number
  errorsList: Array<{ phone: string; error: string }>
}> {
  const errorsList: Array<{ phone: string; error: string }> = []
  let synced = 0
  let errors = 0

  try {
    // Get poll details
    const { data: poll, error: pollError } = await supabaseAdmin
      .from('sms_poll')
      .select('*')
      .eq('id', pollId)
      .single()

    if (pollError || !poll) {
      console.error(`[Retroactive Sync] Poll not found: ${pollId}`, pollError)
      return { synced: 0, errors: 1, errorsList: [{ phone: 'unknown', error: `Poll not found: ${pollId}` }] }
    }

    // Ensure Airtable fields exist for this poll
    console.log(`[Retroactive Sync] Ensuring Airtable fields exist for poll: "${poll.question.substring(0, 50)}..."`)
    const airtableFields = await createAirtableFieldsForPoll(poll.question)

    // ALWAYS update poll with newly created field names (they're guaranteed to exist)
    // This ensures we use the correct fields even if old ones were stored with different dates
    await supabaseAdmin
      .from('sms_poll')
      .update({
        airtable_question_field: airtableFields.questionField,
        airtable_response_field: airtableFields.responseField,
        airtable_notes_field: airtableFields.notesField
      } as any)
      .eq('id', pollId)
    
    console.log(`[Retroactive Sync] Updated poll with field names: ${airtableFields.questionField}, ${airtableFields.responseField}, ${airtableFields.notesField}`)

    // Use the newly created field names (guaranteed to exist in Airtable)
    const questionField = airtableFields.questionField
    const responseField = airtableFields.responseField
    const notesField = airtableFields.notesField

    // Get all responses for this poll
    const { data: responses, error: responsesError } = await supabaseAdmin
      .from('sms_poll_response')
      .select('*')
      .eq('poll_id', pollId)
      .eq('response_status', 'answered') // Only sync answered responses

    if (responsesError) {
      console.error(`[Retroactive Sync] Error fetching responses:`, responsesError)
      return { synced: 0, errors: 1, errorsList: [{ phone: 'unknown', error: responsesError.message }] }
    }

    if (!responses || responses.length === 0) {
      console.log(`[Retroactive Sync] No answered responses found for poll ${pollId}`)
      return { synced: 0, errors: 0, errorsList: [] }
    }

    console.log(`[Retroactive Sync] Found ${responses.length} responses to sync for poll ${pollId}`)

    // Sync each response to Airtable
    for (const response of responses) {
      try {
        const phoneE164 = toE164(response.phone)
        const personFieldName = ENV.AIRTABLE_PERSON_FIELD || 'Person'
        const personName = response.person_name || 'Unknown'

        // Build fields object
        const fields: Record<string, any> = {
          [personFieldName]: personName
        }

        // Add poll-specific fields
        if (questionField) {
          fields[questionField] = poll.question
        }
        if (responseField && response.option_label) {
          fields[responseField] = response.option_label
        }
        if (notesField && response.notes) {
          fields[notesField] = response.notes
        }

        // Upsert to Airtable
        const result = await upsertAirtableRecord(
          ENV.AIRTABLE_BASE_ID!,
          ENV.AIRTABLE_TABLE_NAME!,
          phoneE164,
          fields
        )

        if (result.ok) {
          synced++
          console.log(`[Retroactive Sync] ✓ Synced response for ${phoneE164} (${personName}): ${response.option_label}`)
        } else {
          errors++
          const errorMsg = result.error || 'Unknown error'
          errorsList.push({ phone: phoneE164, error: errorMsg })
          console.error(`[Retroactive Sync] ✗ Failed to sync ${phoneE164}:`, errorMsg)
        }
      } catch (err) {
        errors++
        const errorMsg = err instanceof Error ? err.message : String(err)
        errorsList.push({ phone: response.phone, error: errorMsg })
        console.error(`[Retroactive Sync] ✗ Error syncing response ${response.id}:`, err)
      }
    }

    console.log(`[Retroactive Sync] Completed: ${synced} synced, ${errors} errors`)
    return { synced, errors, errorsList }
  } catch (err) {
    console.error(`[Retroactive Sync] Fatal error:`, err)
    return { synced: 0, errors: 1, errorsList: [{ phone: 'unknown', error: err instanceof Error ? err.message : String(err) }] }
  }
}

/**
 * Sync the most recent poll (by most recent response received)
 * This finds the poll that has the most recent responses, indicating it's the active poll
 * Can optionally filter by question keywords
 */
export async function syncMostRecentPollToAirtable(questionKeywords?: string): Promise<{
  synced: number
  errors: number
  pollId?: string
  question?: string
  errorsList: Array<{ phone: string; error: string }>
}> {
  try {
    // Strategy 0: If keywords provided, search for poll matching those keywords first
    if (questionKeywords) {
      // Normalize keywords: split by spaces/underscores, filter empty, handle variations
      const normalizedKeywords = questionKeywords.toLowerCase()
        .replace(/[_\s]+/g, ' ') // Replace underscores with spaces
        .split(/\s+/)
        .filter(Boolean)
        .map(k => k.replace(/[^a-z0-9]/g, '')) // Remove punctuation for matching
        .filter(k => k.length > 2) // Ignore very short words
      
      console.log(`[Retroactive Sync] Searching for poll with keywords: ${normalizedKeywords.join(', ')}`)
      
      // Get all polls with recent responses (increase limit to catch more polls)
      const { data: recentResponses, error: responseError } = await supabaseAdmin
        .from('sms_poll_response')
        .select('poll_id, received_at, sms_poll!inner(id, question, sent_at, created_at, status)')
        .order('received_at', { ascending: false })
        .limit(100) // Check last 100 responses to find matching poll
      
      if (!responseError && recentResponses) {
        // Also get all recent polls directly from sms_poll table for better coverage
        const { data: allRecentPolls } = await supabaseAdmin
          .from('sms_poll')
          .select('id, question, sent_at, created_at, status')
          .order('sent_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(50)
        
        // Combine both sources and dedupe by poll ID
        const pollMap = new Map<string, any>()
        
        // Add polls from responses
        for (const response of recentResponses) {
          if (response.sms_poll && !pollMap.has(response.sms_poll.id)) {
            pollMap.set(response.sms_poll.id, {
              ...response.sms_poll,
              lastResponseAt: response.received_at
            })
          }
        }
        
        // Add polls from direct query
        for (const poll of allRecentPolls || []) {
          if (!pollMap.has(poll.id)) {
            pollMap.set(poll.id, poll)
          }
        }
        
        const allPolls = Array.from(pollMap.values())
        console.log(`[Retroactive Sync] Checking ${allPolls.length} unique polls for keyword match`)
        
        // Score each poll by how many keywords match
        const scoredPolls = allPolls.map(poll => {
          const questionLower = poll.question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
          let score = 0
          let matchedKeywords: string[] = []
          
          for (const keyword of normalizedKeywords) {
            // Check if keyword appears in question (handle variations)
            if (questionLower.includes(keyword)) {
              score += 2 // Exact match
              matchedKeywords.push(keyword)
            } else if (keyword.length > 3) {
              // Try partial match for longer keywords
              const partialMatch = questionLower.split(/\s+/).some(word => 
                word.includes(keyword) || keyword.includes(word)
              )
              if (partialMatch) {
                score += 1 // Partial match
                matchedKeywords.push(keyword)
              }
            }
          }
          
          return { poll, score, matchedKeywords }
        })
        
        // Sort by score (highest first), then by last response time
        scoredPolls.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          const aTime = a.poll.lastResponseAt || a.poll.sent_at || a.poll.created_at
          const bTime = b.poll.lastResponseAt || b.poll.sent_at || b.poll.created_at
          return new Date(bTime || 0).getTime() - new Date(aTime || 0).getTime()
        })
        
        // Find best match (score > 0)
        const bestMatch = scoredPolls.find(sp => sp.score > 0)
        
        if (bestMatch) {
          const poll = bestMatch.poll
          console.log(`[Retroactive Sync] Found matching poll: ${poll.id} - "${poll.question.substring(0, 50)}..." (score: ${bestMatch.score}, matched: ${bestMatch.matchedKeywords.join(', ')})`)
          const result = await syncPollResponsesToAirtable(poll.id)
          return {
            ...result,
            pollId: poll.id,
            question: poll.question
          }
        }
        
        console.log(`[Retroactive Sync] No poll found matching keywords: ${normalizedKeywords.join(', ')}, falling back to most recent`)
        console.log(`[Retroactive Sync] Available polls: ${allPolls.slice(0, 5).map(p => `"${p.question.substring(0, 40)}..."`).join(', ')}`)
      }
    }
    
    // Strategy 1: Find poll with most recent response received (most reliable indicator of active poll)
    const { data: recentResponse, error: responseError } = await supabaseAdmin
      .from('sms_poll_response')
      .select('poll_id, received_at, sms_poll!inner(id, question, sent_at, created_at, status)')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!responseError && recentResponse?.sms_poll) {
      const poll = recentResponse.sms_poll
      console.log(`[Retroactive Sync] Found poll with most recent response: ${poll.id} - "${poll.question.substring(0, 50)}..." (last response: ${recentResponse.received_at})`)
      const result = await syncPollResponsesToAirtable(poll.id)
      return {
        ...result,
        pollId: poll.id,
        question: poll.question
      }
    }

    // Strategy 2: Fallback to poll with most recent sent_at
    console.log(`[Retroactive Sync] No recent responses found, falling back to most recently sent poll...`)
    const { data: polls, error: pollsError } = await supabaseAdmin
      .from('sms_poll')
      .select('id, question, sent_at, created_at, status')
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1)

    if (!pollsError && polls && polls.length > 0) {
      const poll = polls[0]
      console.log(`[Retroactive Sync] Syncing most recently sent poll: ${poll.id} - "${poll.question.substring(0, 50)}..." (sent_at: ${poll.sent_at})`)
      const result = await syncPollResponsesToAirtable(poll.id)
      return {
        ...result,
        pollId: poll.id,
        question: poll.question
      }
    }

    // Strategy 3: Fallback to most recently created poll
    const { data: createdPolls, error: createdError } = await supabaseAdmin
      .from('sms_poll')
      .select('id, question, created_at, status')
      .order('created_at', { ascending: false })
      .limit(1)

    if (createdError || !createdPolls || createdPolls.length === 0) {
      console.error(`[Retroactive Sync] No polls found:`, createdError)
      return { synced: 0, errors: 1, errorsList: [{ phone: 'unknown', error: 'No polls found' }] }
    }

    const poll = createdPolls[0]
    console.log(`[Retroactive Sync] Syncing most recently created poll: ${poll.id} - "${poll.question.substring(0, 50)}..." (created_at: ${poll.created_at})`)
    const result = await syncPollResponsesToAirtable(poll.id)
    
    return {
      ...result,
      pollId: poll.id,
      question: poll.question
    }
  } catch (err) {
    console.error(`[Retroactive Sync] Fatal error syncing most recent poll:`, err)
    return { synced: 0, errors: 1, errorsList: [{ phone: 'unknown', error: err instanceof Error ? err.message : String(err) }] }
  }
}

/**
 * Sync all poll responses for all sent polls
 */
export async function syncAllPollResponsesToAirtable(): Promise<{
  totalSynced: number
  totalErrors: number
  pollResults: Array<{ pollId: string; question: string; synced: number; errors: number }>
}> {
  let totalSynced = 0
  let totalErrors = 0
  const pollResults: Array<{ pollId: string; question: string; synced: number; errors: number }> = []

  try {
    // Get all sent polls
    const { data: polls, error: pollsError } = await supabaseAdmin
      .from('sms_poll')
      .select('id, question, sent_at')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })

    if (pollsError) {
      console.error(`[Retroactive Sync] Error fetching polls:`, pollsError)
      return { totalSynced: 0, totalErrors: 1, pollResults: [] }
    }

    if (!polls || polls.length === 0) {
      console.log(`[Retroactive Sync] No sent polls found`)
      return { totalSynced: 0, totalErrors: 0, pollResults: [] }
    }

    console.log(`[Retroactive Sync] Found ${polls.length} sent polls to sync`)

    // Sync each poll
    for (const poll of polls) {
      console.log(`[Retroactive Sync] Syncing poll: ${poll.id} - "${poll.question.substring(0, 50)}..."`)
      const result = await syncPollResponsesToAirtable(poll.id)
      
      totalSynced += result.synced
      totalErrors += result.errors
      
      pollResults.push({
        pollId: poll.id,
        question: poll.question,
        synced: result.synced,
        errors: result.errors
      })

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    console.log(`[Retroactive Sync] All polls completed: ${totalSynced} total synced, ${totalErrors} total errors`)
    return { totalSynced, totalErrors, pollResults }
  } catch (err) {
    console.error(`[Retroactive Sync] Fatal error:`, err)
    return { totalSynced: 0, totalErrors: 1, pollResults: [] }
  }
}

