/**
 * Integration Tests for Session State Machine
 * 
 * These tests demonstrate the key scenarios that should work correctly:
 * 1. Verbatim text handling
 * 2. State machine guardrails
 * 3. Deterministic routing
 */

import { parseVerbatimConstraint } from '../constraint'
import { routeWithRules } from '../router'
import { reduce, initializeState } from '../reducer'
import { renderPreview } from '../preview'

describe('Verbatim Constraint Parsing', () => {
  test('extracts text from "with this exact text:" pattern', () => {
    const result = parseVerbatimConstraint('With this exact text: football tomorrow at 6am im fields')
    expect(result.is_verbatim).toBe(true)
    expect(result.text).toBe('football tomorrow at 6am im fields')
    expect(result.source).toBe('colon_pattern')
  })
  
  test('extracts text from quoted strings', () => {
    const result = parseVerbatimConstraint('say "meeting at 9pm tonight"')
    expect(result.is_verbatim).toBe(true)
    expect(result.text).toBe('meeting at 9pm tonight')
    expect(result.source).toBe('quoted')
  })
  
  test('detects exact/verbatim keywords', () => {
    const result = parseVerbatimConstraint('use my exact wording for the announcement')
    expect(result.is_verbatim).toBe(true)
    expect(result.source).toBe('explicit_keyword')
  })
})

describe('Deterministic Router', () => {
  test('routes "send out a message:" to announcement', () => {
    const intent = routeWithRules('send out a message: football tomorrow')
    expect(intent?.type).toBe('announcement')
    expect(intent?.mode_transition).toBe('drafting')
  })
  
  test('routes control commands correctly', () => {
    const sendIntent = routeWithRules('send it')
    expect(sendIntent?.is_control_command).toBe(true)
    expect(sendIntent?.mode_transition).toBe('sending')
    
    const cancelIntent = routeWithRules('cancel')
    expect(cancelIntent?.is_control_command).toBe(true)
    expect(cancelIntent?.mode_transition).toBe('idle')
  })
  
  test('routes questions to query', () => {
    const intent = routeWithRules('when is active meeting?')
    expect(intent?.type).toBe('query')
  })
})

describe('State Machine Guardrails', () => {
  test('blocks transition to smalltalk from confirming without control command', () => {
    const state = {
      ...initializeState(),
      mode: 'confirming' as const,
      draft: {
        id: 'test',
        type: 'announcement' as const,
        slots: { body: 'test message' },
        constraints: { verbatim_only: false, must_include: [], must_not_change: [] },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    }
    
    const intent = { type: 'smalltalk' as const }
    const newState = reduce(state, intent, 'cool')
    
    // State should not change - guardrail blocks it
    expect(newState.mode).toBe('confirming')
    expect(newState.draft).toBeDefined()
  })
  
  test('allows transition with control command', () => {
    const state = {
      ...initializeState(),
      mode: 'confirming' as const,
      draft: {
        id: 'test',
        type: 'announcement' as const,
        slots: { body: 'test message' },
        constraints: { verbatim_only: false, must_include: [], must_not_change: [] },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    }
    
    const intent = { type: 'system' as const, is_control_command: true, mode_transition: 'idle' as const }
    const newState = reduce(state, intent, 'cancel')
    
    // State should change - control command overrides
    expect(newState.mode).toBe('idle')
    expect(newState.draft).toBeNull()
  })
})

describe('Preview Rendering', () => {
  test('renders verbatim text exactly', () => {
    const draft = {
      id: 'test',
      type: 'announcement' as const,
      verbatim: 'football tomorrow at 6am im fields',
      slots: {},
      constraints: { verbatim_only: true, must_include: [], must_not_change: [] },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    const preview = renderPreview(draft)
    expect(preview).toBe('football tomorrow at 6am im fields')
  })
  
  test('assembles from slots when not verbatim', () => {
    const draft = {
      id: 'test',
      type: 'announcement' as const,
      slots: {
        body: 'meeting',
        time: '21:00:00',
        location: 'SAC'
      },
      constraints: { verbatim_only: false, must_include: [], must_not_change: [] },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    const preview = renderPreview(draft)
    expect(preview).toContain('meeting')
    expect(preview).toContain('9pm')
    expect(preview).toContain('SAC')
  })
})


