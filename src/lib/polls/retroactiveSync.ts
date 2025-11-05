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

    // Update poll with field names if they weren't set
    if (!poll.airtable_question_field || !poll.airtable_response_field || !poll.airtable_notes_field) {
      await supabaseAdmin
        .from('sms_poll')
        .update({
          airtable_question_field: airtableFields.questionField,
          airtable_response_field: airtableFields.responseField,
          airtable_notes_field: airtableFields.notesField
        } as any)
        .eq('id', pollId)
      
      console.log(`[Retroactive Sync] Updated poll with field names: ${airtableFields.questionField}, ${airtableFields.responseField}, ${airtableFields.notesField}`)
    }

    // Use the field names from poll (or newly created ones)
    const questionField = poll.airtable_question_field || airtableFields.questionField
    const responseField = poll.airtable_response_field || airtableFields.responseField
    const notesField = poll.airtable_notes_field || airtableFields.notesField

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

