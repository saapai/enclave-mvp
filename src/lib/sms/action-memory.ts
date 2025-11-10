/**
 * Action Memory System
 * 
 * Tracks recent actions and context so the bot can answer questions about
 * what it did, what it found, and what the user did.
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface ActionMemory {
  type: 'query' | 'announcement_sent' | 'poll_sent' | 'poll_response_recorded' | 'draft_created' | 'draft_updated'
  timestamp: string
  details: {
    query?: string
    queryResults?: number
    queryAnswer?: string
    announcementContent?: string
    pollQuestion?: string
    pollResponse?: string
    draftType?: 'announcement' | 'poll'
  }
}

/**
 * Save an action to memory (fire-and-forget, non-blocking)
 */
export function saveAction(
  phoneNumber: string,
  action: Omit<ActionMemory, 'timestamp'>
): void {
  // Fire-and-forget: don't await, don't block
  const savePromise = (async () => {
    try {
      console.log(`[ActionMemory] Saving action for ${phoneNumber}: ${action.type}`)
      const { error } = await supabaseAdmin
        .from('sms_action_memory')
        .insert({
          phone: phoneNumber,
          action_type: action.type,
          action_details: action.details,
          created_at: new Date().toISOString()
        })
      
      if (error) {
        console.error('[ActionMemory] Failed to save action:', {
          message: error.message,
          details: error.details || '',
          hint: error.hint || '',
          code: error.code || ''
        })
      } else {
        console.log('[ActionMemory] Action saved successfully')
      }
    } catch (err: any) {
      console.error('[ActionMemory] Failed to save action:', {
        message: err?.message || 'Unknown error',
        details: err?.toString() || ''
      })
    }
  })()
  
  // Catch any unhandled rejections to prevent process crashes
  savePromise.catch(() => {
    // Already logged above, just prevent unhandled rejection
  })
}

/**
 * Get recent actions for a user
 */
export async function getRecentActions(
  phoneNumber: string,
  limit: number = 10
): Promise<ActionMemory[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('sms_action_memory')
      .select('action_type, action_details, created_at')
      .eq('phone', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[ActionMemory] Failed to load actions:', error)
      return []
    }

    if (!data) return []

    return data.map(row => ({
      type: row.action_type as ActionMemory['type'],
      timestamp: row.created_at,
      details: row.action_details || {}
    }))
  } catch (err) {
    console.error('[ActionMemory] Failed to load actions:', err)
    return []
  }
}

/**
 * Check if user is asking about a past action
 */
export async function checkActionQuery(
  phoneNumber: string,
  messageText: string
): Promise<{ isActionQuery: boolean; response?: string }> {
  const lower = messageText.toLowerCase()
  
  // Patterns for asking about past actions
  const actionQueryPatterns = [
    /did\s+you\s+(find|get|track|record|send|save)/i,
    /(did|have)\s+you\s+(found|gotten|tracked|recorded|sent|saved)/i,
    /(did|have)\s+i\s+(respond|answer|reply)/i,
    /(did|was)\s+(my|the)\s+(response|answer|reply|message|poll)\s+(tracked|recorded|sent|saved)/i,
    /what\s+(did|was)\s+(you|i)\s+(find|send|do)/i,
    /did\s+you\s+find\s+(that|the|it|info|information)/i,
    /(did|have)\s+you\s+(find|found)\s+(that|the|it|info|information)/i,
    /why\s+(didn'?t|did\s+not)\s+you\s+(send|find|get)/i,
    /why\s+didn'?t\s+(you|i)\s+(send|get|find)/i,
    /why\s+(was|wasn'?t)\s+(it|that)\s+(sent|found|sent\s+out)/i,
  ]
  
  const isActionQuery = actionQueryPatterns.some(pattern => pattern.test(messageText))
  
  if (!isActionQuery) {
    return { isActionQuery: false }
  }
  
  // Get recent actions
  const recentActions = await getRecentActions(phoneNumber, 5)
  
  if (recentActions.length === 0) {
    return {
      isActionQuery: true,
      response: "i don't see any recent actions. what would you like me to do?"
    }
  }
  
  // Check what they're asking about
  const askingAboutQuery = /(find|found|get|information|answer|result)/i.test(messageText)
  const askingAboutPoll = /(poll|response|answer|reply)/i.test(messageText)
  const askingAboutAnnouncement = /(announcement|message|send|sent)/i.test(messageText)
  
  // Find relevant action
  let relevantAction: ActionMemory | null = null
  
  if (askingAboutQuery) {
    relevantAction = recentActions.find(a => a.type === 'query') || null
  } else if (askingAboutPoll) {
    relevantAction = recentActions.find(a => 
      a.type === 'poll_sent' || a.type === 'poll_response_recorded'
    ) || null
  } else if (askingAboutAnnouncement) {
    relevantAction = recentActions.find(a => 
      a.type === 'announcement_sent' || a.type === 'draft_created'
    ) || null
  } else {
    // Just return the most recent action
    relevantAction = recentActions[0]
  }
  
  if (!relevantAction) {
    return {
      isActionQuery: true,
      response: "i don't see that in my recent actions. what would you like me to do?"
    }
  }
  
  // Check if asking "why didn't you send"
  const isWhyQuestion = /why\s+(didn'?t|did\s+not)/i.test(messageText)
  const isAboutSending = /(send|sent|send\s+out)/i.test(messageText)
  
  if (isWhyQuestion && isAboutSending) {
    // Check if there was a query that found results
    const queryAction = recentActions.find(a => a.type === 'query' && a.details.queryResults > 0)
    if (queryAction) {
      return {
        isActionQuery: true,
        response: "sorry about that! i found the info but there was a delay sending it. i'll make sure responses go out right away next time."
      }
    }
    return {
      isActionQuery: true,
      response: "i'm not sure what you're referring to. could you clarify?"
    }
  }
  
  // Generate response based on action type
  let response = ''
  
  switch (relevantAction.type) {
    case 'query':
      if (relevantAction.details.queryResults && relevantAction.details.queryResults > 0) {
        response = `yes! i found ${relevantAction.details.queryResults} result${relevantAction.details.queryResults > 1 ? 's' : ''}`
        if (relevantAction.details.queryAnswer) {
          response += `: ${relevantAction.details.queryAnswer.substring(0, 100)}`
        }
      } else {
        response = "i searched but couldn't find any information about that."
      }
      break
      
    case 'poll_response_recorded':
      response = `yes! i recorded your response${relevantAction.details.pollResponse ? `: ${relevantAction.details.pollResponse}` : ''}`
      break
      
    case 'poll_sent':
      response = `yes! i sent the poll${relevantAction.details.pollQuestion ? `: "${relevantAction.details.pollQuestion.substring(0, 50)}"` : ''}`
      break
      
    case 'announcement_sent':
      response = `yes! i sent the announcement${relevantAction.details.announcementContent ? `: "${relevantAction.details.announcementContent.substring(0, 50)}"` : ''}`
      break
      
    case 'draft_created':
    case 'draft_updated':
      response = `yes! i ${relevantAction.type === 'draft_created' ? 'created' : 'updated'} the ${relevantAction.details.draftType || 'draft'}`
      break
      
    default:
      response = "yes, i did that!"
  }
  
  return {
    isActionQuery: true,
    response
  }
}

