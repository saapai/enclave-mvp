/**
 * Action State Retriever
 * 
 * Retrieves live system state: pending drafts, sent announcements/polls, recent responses.
 * Zero LLM risk - direct DB/API reads.
 */

import { supabase } from '@/lib/supabase'
import { getActiveDraft, getPreviousAnnouncements } from '@/lib/announcements'
import { getActivePollDraft } from '@/lib/polls'
import { EvidenceUnit, Draft, Action, PollState } from './types'

/**
 * Normalize phone number (same as SMS route)
 */
function normalizePhone(phone: string): string {
  const cleaned = String(phone).replace(/[^\d]/g, '')
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    return cleaned.substring(1)
  }
  return cleaned.slice(-10)
}

/**
 * Retrieve Action State for a phone number
 */
export async function retrieveActionState(phoneNumber: string): Promise<{
  pending_draft?: Draft
  pending_poll?: PollState
  recent_actions: Action[]
  evidence: EvidenceUnit[]
}> {
  const normalizedPhone = normalizePhone(phoneNumber)
  const phoneE164 = `+1${normalizedPhone}`
  
  // Get pending announcement draft
  const activeDraft = await getActiveDraft(normalizedPhone)
  
  // Get pending poll draft
  const activePollDraft = await getActivePollDraft(normalizedPhone)
  
  // Get pending poll waiting for response
  const { data: pendingPollResponse } = await supabase
    .from('sms_poll_response')
    .select(`
      sms_poll!inner(
        id,
        question,
        options,
        code,
        created_at,
        sent_at
      )
    `)
    .eq('phone', phoneE164)
    .eq('response_status', 'pending')
    .order('sms_poll(created_at)', { ascending: false })
    .limit(1)
    .maybeSingle()
  
  const pendingPoll: PollState | undefined = pendingPollResponse?.sms_poll ? {
    id: pendingPollResponse.sms_poll.id,
    question: pendingPollResponse.sms_poll.question,
    options: pendingPollResponse.sms_poll.options || ['Yes', 'No', 'Maybe'],
    code: pendingPollResponse.sms_poll.code || '',
    sent_at: pendingPollResponse.sms_poll.sent_at || pendingPollResponse.sms_poll.created_at,
  } : undefined
  
  // Get recent announcements (last 10)
  const recentAnnouncements = await getPreviousAnnouncements(normalizedPhone, 10)
  
  // Get recent polls (last 10)
  const { data: recentPolls } = await supabase
    .from('sms_poll')
    .select('id, question, options, code, created_at, sent_at')
    .order('created_at', { ascending: false })
    .limit(10)
  
  // Build evidence units
  const evidence: EvidenceUnit[] = []
  
  if (activeDraft) {
    const audience: string[] | 'all' = activeDraft.targetAudience === 'all' || !activeDraft.targetAudience 
      ? 'all' 
      : [activeDraft.targetAudience]
    
    const draft: Draft = {
      id: activeDraft.id || '',
      kind: 'announcement',
      body: activeDraft.content || '',
      audience,
      created_by: normalizedPhone,
      last_edit_ts: activeDraft.updatedAt || new Date().toISOString(),
      workspace_id: activeDraft.workspaceId
    }
    
    evidence.push({
      scope: 'ACTION',
      source_id: `draft_${draft.id}`,
      text: `Pending announcement draft: "${draft.body}"`,
      ts: draft.last_edit_ts,
      acl_ok: true,
      scores: { semantic: 1.0, keyword: 1.0, freshness: 1.0, role_match: 1.0 }
    })
  }
  
  if (activePollDraft) {
    const pollDraft: Draft = {
      id: activePollDraft.id || '',
      kind: 'poll',
      question: activePollDraft.question || '',
      options: activePollDraft.options || ['Yes', 'No', 'Maybe'],
      audience: 'all',
      created_by: normalizedPhone,
      last_edit_ts: activePollDraft.updatedAt || activePollDraft.createdAt || new Date().toISOString(),
      workspace_id: activePollDraft.workspaceId
    }
    
    const optionsText = (pollDraft.options || []).join(', ')
    evidence.push({
      scope: 'ACTION',
      source_id: `poll_draft_${pollDraft.id}`,
      text: `Pending poll draft: "${pollDraft.question}" (options: ${optionsText})`,
      ts: pollDraft.last_edit_ts,
      acl_ok: true,
      scores: { semantic: 1.0, keyword: 1.0, freshness: 1.0, role_match: 1.0 }
    })
  }
  
  if (pendingPoll) {
    evidence.push({
      scope: 'ACTION',
      source_id: `pending_poll_${pendingPoll.id}`,
      text: `Pending poll response: "${pendingPoll.question}" (code: ${pendingPoll.code})`,
      ts: pendingPoll.sent_at,
      acl_ok: true,
      scores: { semantic: 1.0, keyword: 1.0, freshness: 1.0, role_match: 1.0 }
    })
  }
  
  // Build recent actions
  const recent_actions: Action[] = []
  
  // Get sent announcements with full details from DB
  const { data: sentAnnouncements } = await supabase
    .from('announcement')
    .select('id, final_content, draft_content, tone, target_audience, sent_at, created_at')
    .eq('creator_phone', normalizedPhone)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(10)
  
  for (const ann of sentAnnouncements || []) {
    recent_actions.push({
      id: ann.id || '',
      kind: 'announcement_sent',
      ts: ann.sent_at || ann.created_at || new Date().toISOString(),
      payload: {
        content: ann.final_content || ann.draft_content,
        audience: ann.target_audience,
        tone: ann.tone
      }
    })
  }
  
  for (const poll of recentPolls || []) {
    // Get response count
    const { count: responseCount } = await supabase
      .from('sms_poll_response')
      .select('*', { count: 'exact', head: true })
      .eq('poll_id', poll.id)
      .eq('response_status', 'completed')
    
    recent_actions.push({
      id: poll.id,
      kind: 'poll_sent',
      ts: poll.sent_at || poll.created_at || new Date().toISOString(),
      payload: {
        question: poll.question,
        options: poll.options,
        code: poll.code,
        response_count: responseCount || 0
      }
    })
  }
  
  // Sort actions by timestamp
  recent_actions.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  
  // Build pending draft
  let pending_draft: Draft | undefined = undefined
  
  if (activeDraft) {
    const audience: string[] | 'all' = activeDraft.targetAudience === 'all' || !activeDraft.targetAudience 
      ? 'all' 
      : [activeDraft.targetAudience]
    
    pending_draft = {
      id: activeDraft.id || '',
      kind: 'announcement',
      body: activeDraft.content || '',
      audience,
      created_by: normalizedPhone,
      last_edit_ts: activeDraft.updatedAt || new Date().toISOString(),
      workspace_id: activeDraft.workspaceId
    }
  } else if (activePollDraft) {
    pending_draft = {
      id: activePollDraft.id || '',
      kind: 'poll',
      question: activePollDraft.question || '',
      options: activePollDraft.options || ['Yes', 'No', 'Maybe'],
      audience: 'all',
      created_by: normalizedPhone,
      last_edit_ts: activePollDraft.updatedAt || activePollDraft.createdAt || new Date().toISOString(),
      workspace_id: activePollDraft.workspaceId
    }
  }
  
  return {
    pending_draft,
    pending_poll: pendingPoll,
    recent_actions: recent_actions.slice(0, 10),
    evidence
  }
}

