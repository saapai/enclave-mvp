/**
 * Orchestrator-First Enclave Types
 * 
 * Core data contracts for the orchestrator system
 */

export type Scope = 'CONVO' | 'RESOURCE' | 'ENCLAVE' | 'ACTION' | 'SMALLTALK'

export type Intent = 
  | 'small_talk' 
  | 'info_query' 
  | 'encl_query' 
  | 'draft_create' 
  | 'draft_edit' 
  | 'send_action' 
  | 'state_query' 
  | 'mixed'

export type ResponseMode = 
  | 'Answer' 
  | 'DraftProposal' 
  | 'DraftEdit' 
  | 'ActionConfirm' 
  | 'ActionExecute' 
  | 'ChitChat'

export interface TurnContext {
  user_id?: string
  org_id?: string
  phone_number: string
  last_messages: Array<{speaker: 'user' | 'bot'; text: string; ts: string}>
  pending_draft?: Draft
}

export interface EvidenceUnit {
  scope: Scope
  source_id: string
  text: string
  ts?: string
  acl_ok: boolean
  scores: {
    semantic: number
    keyword: number
    freshness: number
    role_match: number
  }
}

export interface ContextEnvelope {
  intent: Intent
  scopes: Scope[]
  evidence: EvidenceUnit[]
  system_state: {
    pending_draft?: Draft
    recent_actions?: Action[]
    pending_poll?: PollState
  }
}

export interface Draft {
  id: string
  kind: 'announcement' | 'poll'
  title?: string
  body?: string
  question?: string  // for polls
  options?: string[]  // for polls
  audience: string[] | 'all'
  created_by: string
  last_edit_ts: string
  workspace_id?: string
}

export interface Action {
  id: string
  kind: 'announcement_sent' | 'poll_sent' | 'poll_responses_agg'
  ts: string
  payload: any
}

export interface PollState {
  id: string
  question: string
  options: string[]
  code: string
  sent_at: string
  response_count?: number
}

export interface ScopeBudget {
  k: number  // max items to retrieve (no token limits - let context determine what's needed)
}

