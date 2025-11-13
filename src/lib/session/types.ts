/**
 * Canonical Session State Schema
 * 
 * Single source of truth for all conversation state.
 * State machine prevents drift and hallucinations.
 */

export type Mode = 'idle' | 'drafting' | 'editing' | 'confirming' | 'sending'

export type DraftType = 'announcement' | 'poll' | 'query' | 'smalltalk' | 'system'

export interface DraftSlots {
  title?: string | null
  body?: string | null
  time?: string | null // ISO8601
  date?: string | null // ISO8601
  location?: string | null
  audience?: 'all' | 'pledges' | 'actives' | string | null
  question?: string | null // for polls
  options?: string[] | null // for polls
}

export interface DraftConstraints {
  verbatim_only: boolean
  must_include: string[]
  must_not_change: string[]
}

export interface Draft {
  id: string
  type: DraftType
  verbatim?: string | null
  slots: DraftSlots
  constraints: DraftConstraints
  created_at: string
  updated_at: string
}

export interface SessionState {
  mode: Mode
  draft?: Draft | null
  history_window_ids: string[]
  last_updated_at: string
}

export interface Intent {
  type: DraftType
  mode_transition?: Mode
  fields_changed?: Partial<DraftSlots>
  fields_locked?: string[]
  quoted_text?: string
  is_control_command?: boolean // send/cancel/edit
}

export interface VerbatimConstraint {
  is_verbatim: boolean
  text?: string
  source: 'quoted' | 'explicit_keyword' | 'colon_pattern' | 'none'
}

export interface Message {
  id: string
  role: 'user' | 'bot'
  text: string
  timestamp: string
}



