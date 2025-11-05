/**
 * Execute Router
 * 
 * Routes to the appropriate execute handler based on ResponseMode
 */

import { TurnFrame, ContextEnvelope, ResponseMode } from '../types'
import { executeAnswer } from './answer'
import { executeDraftEdit } from './draftEdit'
import { executeDraftCreate } from './draftCreate'
import { executePollEdit } from './pollEdit'
import { executePollCreate } from './pollCreate'
import { executeActionConfirm } from './actionConfirm'
import { executeActionExecute } from './actionExecute'
import { executeChitChat } from './chitChat'

export interface ExecuteResult {
  messages: string[]
  newMode?: 'IDLE' | 'ANNOUNCEMENT_INPUT' | 'POLL_INPUT' | 'CONFIRM_SEND'
}

/**
 * Execute based on ResponseMode
 */
export async function execute(
  mode: ResponseMode,
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  switch (mode) {
    case 'Answer':
      return executeAnswer(frame, envelope)
    
    case 'DraftCreate':
      return executeDraftCreate(frame, envelope)
    
    case 'DraftEdit':
      return executeDraftEdit(frame, envelope)
    
    case 'PollCreate':
      return executePollCreate(frame, envelope)
    
    case 'PollEdit':
      return executePollEdit(frame, envelope)
    
    case 'ActionConfirm':
      return executeActionConfirm(frame, envelope)
    
    case 'ActionExecute':
      return executeActionExecute(frame, envelope)
    
    case 'ChitChat':
      return executeChitChat(frame, envelope)
    
    default:
      return {
        messages: ['I couldn\'t process that request.']
      }
  }
}

