/**
 * State Machine Reducer
 * 
 * Pure reducer with guardrails to prevent drift.
 * State is the source of truth - intents cannot override mode without control commands.
 */

import { SessionState, Intent, Draft, Mode, DraftSlots, DraftConstraints } from './types'
import { parseVerbatimConstraint, parseMustInclude, parseMustNotChange } from './constraint'

/**
 * Create a new draft from intent
 */
function createDraft(intent: Intent, phoneNumber: string): Draft {
  const now = new Date().toISOString()
  const verbatimConstraint = intent.quoted_text ? parseVerbatimConstraint(intent.quoted_text) : { is_verbatim: false, source: 'none' as const }
  
  return {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: intent.type,
    verbatim: verbatimConstraint.is_verbatim ? verbatimConstraint.text : null,
    slots: intent.fields_changed || {},
    constraints: {
      verbatim_only: verbatimConstraint.is_verbatim,
      must_include: [],
      must_not_change: intent.fields_locked || []
    },
    created_at: now,
    updated_at: now
  }
}

/**
 * Apply field changes to draft while respecting constraints
 */
function applyFieldChanges(
  draft: Draft,
  fields: Partial<DraftSlots>,
  verbatimText?: string,
  lockedFields?: string[]
): Draft {
  const newSlots = { ...draft.slots }
  
  // If verbatim text provided, replace body entirely
  if (verbatimText) {
    return {
      ...draft,
      verbatim: verbatimText,
      slots: { ...newSlots, body: verbatimText },
      constraints: {
        ...draft.constraints,
        verbatim_only: true,
        must_not_change: ['body', ...(draft.constraints.must_not_change || [])]
      },
      updated_at: new Date().toISOString()
    }
  }
  
  // Apply field changes, respecting must_not_change constraints
  for (const [key, value] of Object.entries(fields)) {
    if (!draft.constraints.must_not_change.includes(key)) {
      (newSlots as any)[key] = value
    }
  }
  
  // Add any newly locked fields
  const newConstraints = { ...draft.constraints }
  if (lockedFields) {
    newConstraints.must_not_change = [
      ...new Set([...newConstraints.must_not_change, ...lockedFields])
    ]
  }
  
  return {
    ...draft,
    slots: newSlots,
    constraints: newConstraints,
    updated_at: new Date().toISOString()
  }
}

/**
 * Guardrail: Check if mode transition is allowed
 * 
 * Rules:
 * - From drafting/editing/confirming → CANNOT switch to idle/smalltalk without cancel command
 * - From drafting/editing/confirming → CAN switch to editing/confirming with explicit intent
 * - From idle → CAN switch to any mode
 */
function isAllowedTransition(currentMode: Mode, intent: Intent): boolean {
  // Control commands always allowed
  if (intent.is_control_command) {
    return true
  }
  
  // From idle, any transition is allowed
  if (currentMode === 'idle') {
    return true
  }
  
  // From active modes (drafting/editing/confirming), only specific transitions allowed
  if (currentMode === 'drafting' || currentMode === 'editing' || currentMode === 'confirming') {
    // Cannot switch to query or smalltalk without cancel
    if (intent.type === 'query' || intent.type === 'smalltalk') {
      return false // block the transition
    }
    
    // Can transition between draft states
    if (intent.mode_transition === 'editing' || intent.mode_transition === 'confirming') {
      return true
    }
    
    // Default: stay in current mode
    return false
  }
  
  return true
}

/**
 * Main reducer - pure function that updates state based on intent
 */
export function reduce(state: SessionState, intent: Intent, messageText: string): SessionState {
  const now = new Date().toISOString()
  
  // Guardrail: Check if transition is allowed
  if (!isAllowedTransition(state.mode, intent)) {
    console.log(`[State Machine] Blocked transition from ${state.mode} to ${intent.type} (not a control command)`)
    
    // Handle queries and smalltalk as side_chat (don't change mode)
    if (intent.type === 'query' || intent.type === 'smalltalk') {
      return {
        ...state,
        last_updated_at: now
        // mode stays the same, draft stays the same
      }
    }
    
    // Otherwise, keep current state
    return {
      ...state,
      last_updated_at: now
    }
  }
  
  // Handle control commands
  if (intent.is_control_command) {
    if (intent.mode_transition === 'sending') {
      // Send command - keep draft but change mode to sending
      return {
        ...state,
        mode: 'sending',
        last_updated_at: now
      }
    }
    
    if (intent.mode_transition === 'idle') {
      // Cancel command - clear draft and go idle
      return {
        mode: 'idle',
        draft: null,
        history_window_ids: state.history_window_ids,
        last_updated_at: now
      }
    }
    
    if (intent.mode_transition === 'editing') {
      // Edit command - go to editing mode
      return {
        ...state,
        mode: 'editing',
        last_updated_at: now
      }
    }
  }
  
  // Handle new draft creation
  if (intent.mode_transition === 'drafting' && intent.type !== 'query' && intent.type !== 'smalltalk') {
    const newDraft = createDraft(intent, 'current_user') // TODO: get actual phone number
    return {
      mode: 'drafting',
      draft: newDraft,
      history_window_ids: state.history_window_ids,
      last_updated_at: now
    }
  }
  
  // Handle draft editing
  if (intent.mode_transition === 'editing' && state.draft) {
    const updatedDraft = applyFieldChanges(
      state.draft,
      intent.fields_changed || {},
      intent.quoted_text,
      intent.fields_locked
    )
    
    return {
      ...state,
      mode: 'editing',
      draft: updatedDraft,
      last_updated_at: now
    }
  }
  
  // Handle moving to confirm
  if (intent.mode_transition === 'confirming' && state.draft) {
    return {
      ...state,
      mode: 'confirming',
      last_updated_at: now
    }
  }
  
  // Handle queries - keep current mode and draft
  if (intent.type === 'query') {
    return {
      ...state,
      last_updated_at: now
      // mode and draft stay the same
    }
  }
  
  // Default: no state change
  return {
    ...state,
    last_updated_at: now
  }
}

/**
 * Initialize session state
 */
export function initializeState(): SessionState {
  return {
    mode: 'idle',
    draft: null,
    history_window_ids: [],
    last_updated_at: new Date().toISOString()
  }
}

