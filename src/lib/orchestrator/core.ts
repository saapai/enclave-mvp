/**
 * Orchestrator Core
 * 
 * Main orchestrator that decides which scopes to use and composes responses
 */

import { Intent, Scope, ResponseMode, ContextEnvelope, TurnContext, ScopeBudget, EvidenceUnit } from './types'
import { retrieveActionState } from './actionState'
import { retrieveConvoSnapshot } from './convoSnapshot'
import { routeAction } from '@/lib/nlp/actionRouter'
import { searchResourcesHybrid } from '@/lib/search'
import { retrieveEnclave } from '@/lib/retrievers/enclave'

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

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

function clampScore(value: number | null | undefined, fallback = 0.6): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function computeFreshnessScore(timestamp?: string): number {
  if (!timestamp) {
    return 0.6
  }
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return 0.6
  }
  const diffMs = Date.now() - parsed.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  if (diffDays <= 1) return 1
  if (diffDays <= 7) return 0.85
  if (diffDays <= 30) return 0.7
  if (diffDays <= 90) return 0.5
  return 0.35
}

function deriveRoleMatchScore(resourceType?: string | null): number {
  if (!resourceType) {
    return 0.6
  }
  const normalized = resourceType.toLowerCase()
  if (normalized.includes('policy') || normalized.includes('guideline')) {
    return 0.9
  }
  if (normalized.includes('event') || normalized.includes('calendar')) {
    return 0.8
  }
  if (normalized.includes('announcement') || normalized.includes('doc')) {
    return 0.75
  }
  return 0.6
}

function getResultScore(result: any): number {
  const score = typeof result?.score === 'number' ? result.score : undefined
  if (typeof score === 'number' && !Number.isNaN(score)) {
    return score
  }
  const rank = typeof result?.rank === 'number' ? result.rank : undefined
  if (typeof rank === 'number' && !Number.isNaN(rank)) {
    const normalized = rank > 1 ? rank : rank * 10
    if (normalized < 0) return 0
    if (normalized > 1) return 1
    return normalized
  }
  return 0
}

function mapSearchResultToEvidence(result: any): EvidenceUnit {
  const title = typeof result?.title === 'string' ? result.title.trim() : ''
  const rawBody = typeof result?.body === 'string' ? result.body : ''
  const body = rawBody.replace(/\s+/g, ' ').trim()
  const snippet = body.length > 500 ? `${body.slice(0, 500)}...` : body
  const headingPath: string[] = Array.isArray(result?.metadata?.heading_path)
    ? result.metadata.heading_path.filter((h: unknown): h is string => typeof h === 'string')
    : []
  const lines: string[] = []
  if (title) {
    lines.push(`Title: ${title}`)
  }
  if (headingPath.length > 0) {
    lines.push(`Section: ${headingPath.join(' > ')}`)
  }
  if (snippet) {
    lines.push(snippet)
  }
  if (typeof result?.url === 'string' && result.url.length > 0) {
    lines.push(`Link: ${result.url}`)
  }
  if (lines.length === 0 && result?.type) {
    lines.push(`Resource type: ${result.type}`)
  }

  const ts =
    (typeof result?.updated_at === 'string' && result.updated_at) ||
    (typeof result?.created_at === 'string' && result.created_at) ||
    new Date().toISOString()

  const semanticScore = clampScore(result?.score, 0.65)
  const keywordScore = clampScore(
    typeof result?.rank === 'number'
      ? result.rank > 1
        ? result.rank
        : result.rank * 10
      : undefined,
    semanticScore
  )
  const freshnessScore = computeFreshnessScore(ts)
  const roleMatchScore = deriveRoleMatchScore(result?.type)

  return {
    scope: 'RESOURCE',
    source_id: String(
      result?.id ??
      result?.metadata?.chunk_id ??
      result?.url ??
      `${result?.source || 'resource'}:${ts}`
    ),
    text: lines.join('\n\n'),
    ts,
    acl_ok: true,
    scores: {
      semantic: semanticScore,
      keyword: keywordScore,
      freshness: freshnessScore,
      role_match: roleMatchScore
    }
  }
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
  let cachedActionState: Awaited<ReturnType<typeof retrieveActionState>> | null = null
  const getActionState = async () => {
    if (!cachedActionState) {
      cachedActionState = await retrieveActionState(turnContext.phone_number)
    }
    return cachedActionState
  }
  
  for (const scope of scopes) {
    const budget = SCOPE_BUDGETS[intent][scope]
    
    try {
      let evidence: EvidenceUnit[] = []
      
      switch (scope) {
        case 'CONVO':
          evidence = await retrieveConvoSnapshot(turnContext.phone_number, budget.k)
          break
          
        case 'ACTION':
          const actionState = await getActionState()
          evidence = actionState.evidence.slice(0, budget.k)
          break
          
        case 'RESOURCE':
          {
            const candidateSpaceIds = new Set<string>()
            if (turnContext.org_id) {
              candidateSpaceIds.add(turnContext.org_id)
            }
            if (turnContext.pending_draft?.workspace_id) {
              candidateSpaceIds.add(turnContext.pending_draft.workspace_id)
            }
            if (candidateSpaceIds.size === 0) {
              try {
                const actionStateForResource = await getActionState()
                if (actionStateForResource.pending_draft?.workspace_id) {
                  candidateSpaceIds.add(actionStateForResource.pending_draft.workspace_id)
                }
              } catch (stateError) {
                console.error('[Orchestrator] Failed to load action state for resource search:', stateError)
              }
            }
            if (candidateSpaceIds.size === 0 && turnContext.user_id) {
              candidateSpaceIds.add(DEFAULT_SPACE_ID)
            }
            if (candidateSpaceIds.size === 0) {
              evidence = []
              break
            }

            const searchLimit = Math.max(budget.k * 2, 5)
            const searchResultsLists = await Promise.all(
              Array.from(candidateSpaceIds).map(async (spaceId) => {
                try {
                  return await searchResourcesHybrid(
                    userMessage,
                    spaceId,
                    {},
                    { limit: searchLimit, offset: 0 },
                    turnContext.user_id
                  )
                } catch (searchError) {
                  console.error(`[Orchestrator] Resource search failed for space ${spaceId}:`, searchError)
                  return []
                }
              })
            )

            const combinedResults = searchResultsLists.flat()
            if (combinedResults.length === 0) {
              evidence = []
              break
            }

            const deduped = new Map<string, any>()
            for (const result of combinedResults) {
              const key = String(
                result?.id ??
                result?.metadata?.chunk_id ??
                result?.url ??
                `${result?.source || 'resource'}:${result?.title || ''}`
              )
              const existing = deduped.get(key)
              if (!existing || getResultScore(result) > getResultScore(existing)) {
                deduped.set(key, result)
              }
            }

            const sortedResults = Array.from(deduped.values()).sort(
              (a, b) => getResultScore(b) - getResultScore(a)
            )

            evidence = sortedResults.slice(0, budget.k).map(mapSearchResultToEvidence)
          }
          break
          
        case 'ENCLAVE':
          const enclaveItems = await retrieveEnclave(userMessage)
          evidence = enclaveItems.slice(0, budget.k).map(item => ({
            scope: 'ENCLAVE' as const,
            source_id: item.id,
            text: item.title ? `${item.title}\n\n${item.snippet}` : item.snippet,
            acl_ok: true,
            scores: {
              semantic: item.score,
              keyword: item.score,
              freshness: 0.2,
              role_match: 0.8
            }
          }))
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
