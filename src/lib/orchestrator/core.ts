/**
 * Orchestrator Core
 * 
 * Main orchestrator that decides which scopes to use and composes responses
 */

import { Intent, Scope, ResponseMode, ContextEnvelope, TurnContext, ScopeBudget, EvidenceUnit } from './types'
import { retrieveActionState } from './actionState'
import { retrieveConvoSnapshot } from './convoSnapshot'
import { routeAction } from '@/lib/nlp/actionRouter'

/**
 * Scope budgets per intent (k = max items to retrieve, no token limits)
 */
const SCOPE_BUDGETS: Record<Intent, Record<Scope, ScopeBudget>> = {
  small_talk: {
    CONVO: { k: 5 },
    SMALLTALK: { k: 0 },
    RESOURCE: { k: 0 },
    ENCLAVE: { k: 0 },
    ACTION: { k: 0 }
  },
  info_query: {
    RESOURCE: { k: 10 },  // More context for info queries
    CONVO: { k: 5 },
    SMALLTALK: { k: 0 },
    ENCLAVE: { k: 0 },
    ACTION: { k: 0 }
  },
  encl_query: {
    ENCLAVE: { k: 8 },
    RESOURCE: { k: 5 },  // May need org context for Enclave questions
    CONVO: { k: 3 },
    SMALLTALK: { k: 0 },
    ACTION: { k: 0 }
  },
  draft_create: {
    ACTION: { k: 5 },  // Recent announcements/polls for context
    RESOURCE: { k: 8 },  // More context for drafting
    ENCLAVE: { k: 3 },  // Drafting capabilities
    CONVO: { k: 5 },
    SMALLTALK: { k: 0 }
  },
  draft_edit: {
    ACTION: { k: 1 },  // Current draft only
    RESOURCE: { k: 5 },  // Context for edits
    CONVO: { k: 10 },  // Full conversation context for edits
    SMALLTALK: { k: 0 },
    ENCLAVE: { k: 0 }
  },
  send_action: {
    ACTION: { k: 1 },  // Just check draft exists
    CONVO: { k: 3 },
    SMALLTALK: { k: 0 },
    RESOURCE: { k: 0 },
    ENCLAVE: { k: 0 }
  },
  state_query: {
    ACTION: { k: 10 },  // All recent actions
    CONVO: { k: 3 },
    SMALLTALK: { k: 0 },
    RESOURCE: { k: 0 },
    ENCLAVE: { k: 0 }
  },
  mixed: {
    RESOURCE: { k: 8 },
    ACTION: { k: 5 },
    ENCLAVE: { k: 5 },
    CONVO: { k: 5 },
    SMALLTALK: { k: 0 }
  }
}

/**
 * Relevance thresholds
 */
const THRESHOLDS = {
  primary: 0.6,  // Top-1 relevance score threshold
  auxiliary: 0.4  // Avg top-3 relevance score threshold
}

/**
 * Classify intent from user message
 */
export async function classifyIntent(
  userMessage: string,
  turnContext: TurnContext
): Promise<Intent> {
  const lower = userMessage.toLowerCase().trim()
  
  // Check action router first (deterministic)
  const actionRoute = routeAction(userMessage, !!turnContext.pending_draft)
  
  if (actionRoute.intent === 'CHAT' && actionRoute.confidence >= 0.9) {
    return 'small_talk'
  }
  
  if (actionRoute.intent === 'ACTION') {
    if (actionRoute.operation === 'send') {
      return 'send_action'
    }
    if (actionRoute.operation === 'edit' && turnContext.pending_draft) {
      return 'draft_edit'
    }
    if (actionRoute.operation === 'create' || actionRoute.operation === 'edit') {
      return 'draft_create'
    }
  }
  
  if (actionRoute.intent === 'DRAFT_QUERY') {
    return 'state_query'
  }
  
  if (actionRoute.intent === 'PRODUCT_INFO') {
    return 'encl_query'
  }
  
  // Check for state queries
  if (/^(what|show|tell)\s+(is|does|will)\s+(the\s+)?(draft|announcement|poll)/i.test(userMessage)) {
    return 'state_query'
  }
  
  // Check for info queries (org facts)
  if (/^(when|where|what|who|how)\s+(is|are|was|were)/i.test(userMessage)) {
    return 'info_query'
  }
  
  // Default to info_query if unclear
  return 'info_query'
}

/**
 * Pre-select scopes based on intent
 */
export function preselectScopes(intent: Intent): Scope[] {
  const budgets = SCOPE_BUDGETS[intent]
  return Object.entries(budgets)
    .filter(([_, budget]) => budget.k > 0)
    .map(([scope, _]) => scope as Scope)
}

/**
 * Retrieve evidence from all preselected scopes
 */
export async function retrieveEvidence(
  scopes: Scope[],
  userMessage: string,
  turnContext: TurnContext,
  intent: Intent
): Promise<EvidenceUnit[]> {
  const allEvidence: EvidenceUnit[] = []
  
  for (const scope of scopes) {
    const budget = SCOPE_BUDGETS[intent][scope]
    
    try {
      let evidence: EvidenceUnit[] = []
      
      switch (scope) {
        case 'CONVO':
          evidence = await retrieveConvoSnapshot(turnContext.phone_number, budget.k)
          break
          
        case 'ACTION':
          const actionState = await retrieveActionState(turnContext.phone_number)
          evidence = actionState.evidence.slice(0, budget.k)
          break
          
        case 'RESOURCE':
          // TODO: Implement resource retriever (hybrid search)
          // For now, return empty - will be implemented next
          evidence = []
          break
          
        case 'ENCLAVE':
          // TODO: Implement Enclave product retriever
          // For now, return empty - will be implemented next
          evidence = []
          break
          
        case 'SMALLTALK':
          // No retrieval needed - handled in response generation
          evidence = []
          break
      }
      
      // Cap evidence by k (max items)
      allEvidence.push(...evidence.slice(0, budget.k))
      
    } catch (error) {
      console.error(`[Orchestrator] Error retrieving ${scope}:`, error)
    }
  }
  
  return allEvidence
}

/**
 * Select relevant scopes based on evidence quality
 */
export function selectScopes(evidence: EvidenceUnit[], intent: Intent): Scope[] {
  const scopeScores: Record<Scope, number[]> = {
    CONVO: [],
    RESOURCE: [],
    ENCLAVE: [],
    ACTION: [],
    SMALLTALK: []
  }
  
  // Group evidence by scope and collect scores
  for (const unit of evidence) {
    if (!scopeScores[unit.scope]) {
      scopeScores[unit.scope] = []
    }
    const relevanceScore = 
      unit.scores.semantic * 0.4 +
      unit.scores.keyword * 0.3 +
      unit.scores.freshness * 0.2 +
      unit.scores.role_match * 0.1
    scopeScores[unit.scope].push(relevanceScore)
  }
  
  // Select scopes above thresholds
  const selected: Scope[] = []
  
  for (const [scope, scores] of Object.entries(scopeScores)) {
    if (scores.length === 0) continue
    
    const topScore = Math.max(...scores)
    const avgTop3 = scores
      .sort((a, b) => b - a)
      .slice(0, 3)
      .reduce((sum, s) => sum + s, 0) / Math.min(3, scores.length)
    
    if (topScore >= THRESHOLDS.primary) {
      selected.push(scope as Scope)
    } else if (avgTop3 >= THRESHOLDS.auxiliary && intent === 'mixed') {
      selected.push(scope as Scope)
    }
  }
  
  // Always include CONVO if we have conversation history
  if (evidence.some(e => e.scope === 'CONVO')) {
    selected.push('CONVO')
  }
  
  // Always include ACTION if we have pending drafts/actions
  if (evidence.some(e => e.scope === 'ACTION')) {
    selected.push('ACTION')
  }
  
  return Array.from(new Set(selected))
}

/**
 * Compose ContextEnvelope
 */
export async function composeContextEnvelope(
  intent: Intent,
  scopes: Scope[],
  evidence: EvidenceUnit[],
  turnContext: TurnContext
): Promise<ContextEnvelope> {
  // Filter evidence to selected scopes
  const filteredEvidence = evidence.filter(e => scopes.includes(e.scope))
  
  // Get action state
  const actionState = await retrieveActionState(turnContext.phone_number)
  
  // Sort evidence: ACTION first, then RESOURCE, then ENCLAVE, then CONVO
  const scopeOrder: Scope[] = ['ACTION', 'RESOURCE', 'ENCLAVE', 'CONVO', 'SMALLTALK']
  filteredEvidence.sort((a, b) => {
    const aIndex = scopeOrder.indexOf(a.scope)
    const bIndex = scopeOrder.indexOf(b.scope)
    return aIndex - bIndex
  })
  
  return {
    intent,
    scopes,
    evidence: filteredEvidence,
    system_state: {
      pending_draft: actionState.pending_draft || turnContext.pending_draft,
      recent_actions: actionState.recent_actions,
      pending_poll: actionState.pending_poll
    }
  }
}

/**
 * Decide response mode
 */
export function decideResponseMode(
  intent: Intent,
  envelope: ContextEnvelope,
  userMessage: string,
  turnContext: TurnContext
): ResponseMode {
  if (intent === 'small_talk') {
    return 'ChitChat'
  }
  
  if (intent === 'send_action') {
    if (envelope.system_state.pending_draft) {
      // Check if user explicitly confirmed
      const lower = userMessage.toLowerCase()
      const confirmed = /^(send|yes|yep|go|do it)$/i.test(lower.trim())
      return confirmed ? 'ActionExecute' : 'ActionConfirm'
    }
    return 'ActionConfirm' // No draft to send
  }
  
  if (intent === 'draft_create') {
    return 'DraftProposal'
  }
  
  if (intent === 'draft_edit') {
    return 'DraftEdit'
  }
  
  if (intent === 'state_query') {
    return 'Answer' // Return draft/action state
  }
  
  // Default: Answer
  return 'Answer'
}

/**
 * Main orchestrator handler
 */
export async function handleTurn(
  userMessage: string,
  turnContext: TurnContext
): Promise<{
  envelope: ContextEnvelope
  mode: ResponseMode
}> {
  // 1. Classify intent
  const intent = await classifyIntent(userMessage, turnContext)
  console.log(`[Orchestrator] Intent: ${intent}`)
  
  // 2. Pre-select scopes
  const preselectedScopes = preselectScopes(intent)
  console.log(`[Orchestrator] Preselected scopes: ${preselectedScopes.join(', ')}`)
  
  // 3. Retrieve evidence
  const evidence = await retrieveEvidence(preselectedScopes, userMessage, turnContext, intent)
  console.log(`[Orchestrator] Retrieved ${evidence.length} evidence units`)
  
  // 4. Select relevant scopes
  const selectedScopes = selectScopes(evidence, intent)
  console.log(`[Orchestrator] Selected scopes: ${selectedScopes.join(', ')}`)
  
  // 5. Compose envelope
  const envelope = await composeContextEnvelope(intent, selectedScopes, evidence, turnContext)
  
  // 6. Decide response mode
  const mode = decideResponseMode(intent, envelope, userMessage, turnContext)
  console.log(`[Orchestrator] Response mode: ${mode}`)
  
  return { envelope, mode }
}

