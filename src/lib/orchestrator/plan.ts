/**
 * Plan Function
 * 
 * Deterministic finite-state policy that returns a single ResponseMode
 * based on the TurnFrame. No ambiguity, no "also run query later".
 */

import { TurnFrame, ResponseMode } from './types'

/**
 * Check if text is an explicit question (not just a statement with "?")
 */
function isExplicitQuestion(text: string): boolean {
  const lower = text.toLowerCase().trim()
  
  // Must start with question words to be explicit
  return /^(what|when|where|who|how|why|is|are|was|were|do|does|did|will|can|could|should)\s/.test(lower) && 
         text.includes('?')
}

/**
 * Check if text looks like smalltalk
 */
function looksLikeSmallTalk(text: string): boolean {
  const lower = text.toLowerCase().trim()
  
  const smallTalkPatterns = [
    /^(hi|hey|hello|sup|what'?s\s+up|yo)$/,
    /^(thanks?|thank\s+you|ty|thx)$/,
    /^(ok|okay|sure|alright|got\s+it)$/,
    /^(cool|nice|sweet|lit)$/,
  ]
  
  return smallTalkPatterns.some(pattern => pattern.test(lower))
}

/**
 * Check if text is affirmative (yes, send it, etc.)
 */
function isAffirmative(text: string): boolean {
  const lower = text.toLowerCase().trim()
  
  return /^(yes|yep|yeah|y|send\s+it|send\s+now|broadcast|ship\s+it|confirm)$/.test(lower)
}

/**
 * Check if text wants to edit (no, change it, etc.)
 */
function wantsEdit(text: string): boolean {
  const lower = text.toLowerCase().trim()
  
  return /^(no|nope|change|edit|update|make\s+it|actually)/.test(lower) ||
         lower.includes('change it') ||
         lower.includes('make it')
}

/**
 * Main plan function - deterministic priority arbitration
 */
export function plan(frame: TurnFrame): ResponseMode {
  // Priority 1: Handle toxicity
  if (frame.signals.toxicity === 'abusive') {
    return 'ChitChat'
  }
  
  // Priority 2: Handle based on current mode
  switch (frame.state.mode) {
    case 'ANNOUNCEMENT_INPUT':
      // Cancel command
      if (frame.signals.command === 'CANCEL') {
        return 'ChitChat' // "draft discarded"
      }
      
      // Send command (if draft is ready)
      if (frame.signals.command === 'SEND' && frame.state.pending) {
        return 'ActionConfirm'
      }
      
      // Explicit question while in input mode - answer it but stay in mode
      if (isExplicitQuestion(frame.text)) {
        return 'Answer'
      }
      
      // Default: treat as draft edit
      return 'DraftEdit'
    
    case 'POLL_INPUT':
      // Cancel command
      if (frame.signals.command === 'CANCEL') {
        return 'ChitChat'
      }
      
      // Send command (if draft is ready)
      if (frame.signals.command === 'SEND' && frame.state.pending) {
        return 'ActionConfirm'
      }
      
      // Explicit question while in input mode - answer it but stay in mode
      if (isExplicitQuestion(frame.text)) {
        return 'Answer'
      }
      
      // Default: treat as poll edit
      return 'PollEdit'
    
    case 'CONFIRM_SEND':
      // If user is asking an explicit question, answer it (but stay in CONFIRM_SEND mode)
      if (isExplicitQuestion(frame.text)) {
        return 'Answer'
      }
      
      // User confirmed
      if (isAffirmative(frame.text)) {
        return 'ActionExecute'
      }
      
      // User wants to edit
      if (wantsEdit(frame.text)) {
        // Return to input mode (determined by pending type)
        if (frame.state.pending?.kind === 'announcement') {
          return 'DraftEdit'
        } else if (frame.state.pending?.kind === 'poll') {
          return 'PollEdit'
        }
      }
      
      // Default: remind them to confirm
      return 'ChitChat' // "say 'yes' to send..."
    
    case 'IDLE':
    default:
      // Command to make announcement
      if (frame.signals.command === 'MAKE_ANNOUNCEMENT') {
        return 'DraftCreate'
      }
      
      // Command to make poll
      if (frame.signals.command === 'MAKE_POLL') {
        return 'PollCreate'
      }
      
      // Smalltalk
      if (looksLikeSmallTalk(frame.text)) {
        return 'ChitChat'
      }
      
      // Default: answer query
      return 'Answer'
  }
}

