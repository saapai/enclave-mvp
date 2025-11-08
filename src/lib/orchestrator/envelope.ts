/**
 * Envelope Builder
 * 
 * Builds ContextEnvelope scoped by ResponseMode.
 * Different modes require different retrieval strategies.
 */

import { TurnFrame, ResponseMode, ContextEnvelope, Scope, ScopeBudget } from './types'
import { retrieveActionState } from './actionState'
import { retrieveConvoSnapshot } from './convoSnapshot'

/**
 * Build ContextEnvelope based on ResponseMode
 * This determines what retrieval to run (or skip entirely)
 */
export async function buildEnvelope(
  frame: TurnFrame,
  mode: ResponseMode,
  orgId?: string
): Promise<ContextEnvelope> {
  switch (mode) {
    case 'Answer':
      // Answer queries need RESOURCE and CONVO scopes
      // SKIP convo snapshot retrieval for now - it's hanging
      console.log('[Envelope] Skipping convoSnapshot retrieval to avoid hang')
      // const convoSnapshot = await retrieveConvoSnapshot(frame.user.id, 3)
      // Note: RESOURCE retrieval would be done in execute.answer.ts
      // Here we just structure the envelope
      return {
        intent: 'info_query',
        scopes: ['RESOURCE', 'CONVO'],
        evidence: [], // convoSnapshot.evidence,
        system_state: {
          pending_draft: frame.state.pending?.kind === 'announcement' ? frame.state.pending : undefined,
          pending_poll: frame.state.pending?.kind === 'poll' ? {
            id: frame.state.pending.id,
            question: frame.state.pending.question || '',
            options: frame.state.pending.options || [],
            code: '', // Will be set when poll is sent
            sent_at: new Date().toISOString(),
            response_count: 0
          } : undefined
        }
      }
    
    case 'DraftCreate':
    case 'DraftEdit':
      // Draft editing doesn't need RAG - it's local and structure-aware
      // Just return the pending draft state
      const actionStateForDraft = await retrieveActionState(frame.user.id)
      return {
        intent: mode === 'DraftCreate' ? 'draft_create' : 'draft_edit',
        scopes: [],
        evidence: [],
        system_state: {
          pending_draft: frame.state.pending?.kind === 'announcement' ? frame.state.pending : actionStateForDraft.pending_draft
        }
      }
    
    case 'PollCreate':
    case 'PollEdit':
      // Poll editing is also local
      const actionStateForPoll = await retrieveActionState(frame.user.id)
      return {
        intent: mode === 'PollCreate' ? 'draft_create' : 'draft_edit',
        scopes: [],
        evidence: [],
        system_state: {
          pending_draft: frame.state.pending?.kind === 'poll' ? frame.state.pending : undefined,
          pending_poll: actionStateForPoll.pending_poll
        }
      }
    
    case 'ActionConfirm':
    case 'ActionExecute':
      // Action modes need the pending draft and recent actions
      const actionState = await retrieveActionState(frame.user.id)
      return {
        intent: 'send_action',
        scopes: [],
        evidence: [],
        system_state: {
          pending_draft: frame.state.pending?.kind === 'announcement' ? frame.state.pending : actionState.pending_draft,
          pending_poll: frame.state.pending?.kind === 'poll' ? {
            id: frame.state.pending.id,
            question: frame.state.pending.question || '',
            options: frame.state.pending.options || [],
            code: '',
            sent_at: new Date().toISOString(),
            response_count: 0
          } : actionState.pending_poll,
          recent_actions: actionState.recent_actions
        }
      }
    
    case 'ChitChat':
      // Smalltalk doesn't need retrieval
      return {
        intent: 'small_talk',
        scopes: [],
        evidence: [],
        system_state: {}
      }
    
    default:
      return {
        intent: 'info_query',
        scopes: [],
        evidence: [],
        system_state: {}
      }
  }
}

