/**
 * Hybrid Search V2 - Sequential, budget-aware, single-threaded implementation
 * 
 * Key improvements:
 * 1. FTS using proper RPC (not ILIKE)
 * 2. Sequential workspace processing (not parallel)
 * 3. Budget-aware execution with early exit
 * 4. Embedding cache and reuse
 * 5. Circuit breaker for failing operations
 */

import { supabase, supabaseAdmin } from './supabase'
import { embedText } from './embeddings'
import type { SearchResult } from './search'

// ============================================================================
// CONFIGURATION
// ============================================================================

const SMS_SEARCH_BUDGET_MS = Number(process.env.SMS_SEARCH_BUDGET_MS || '10000') // 10s total budget
const SMS_FTS_TIMEOUT_MS = Number(process.env.SMS_FTS_TIMEOUT_MS || '4000') // 4s per FTS
const SMS_EMBED_TIMEOUT_MS = Number(process.env.SMS_EMBED_TIMEOUT_MS || '9000') // 9s for embedding
const SMS_VECTOR_TIMEOUT_MS = Number(process.env.SMS_VECTOR_TIMEOUT_MS || '4000') // 4s per vector
const SMS_EMBED_MIN_REMAINING_MS = Number(process.env.SMS_EMBED_MIN_REMAINING_MS || '3000') // Need 3s left to embed
const SMS_FTS_HARD_TIMEOUT_MS = Number(process.env.SMS_FTS_HARD_TIMEOUT_MS || '3900')
const SMS_VECTOR_HARD_TIMEOUT_MS = Number(process.env.SMS_VECTOR_HARD_TIMEOUT_MS || '3900')
const SMS_FTS_CONFIDENCE_THRESHOLD = Number(process.env.SMS_FTS_CONFIDENCE_THRESHOLD || '0.95')
const SMS_WAIT_FOR_EMBED_MS = Number(process.env.SMS_WAIT_FOR_EMBED_MS || '500')
const EMBEDDING_RETRY_DELAYS_MS = [300, 800]

// Circuit breaker: if embedding fails 3 times in 5 min, disable for next queries
const embeddingFailures: number[] = []
const CIRCUIT_BREAKER_WINDOW_MS = 30000 // 30 seconds
const CIRCUIT_BREAKER_THRESHOLD = 3
const CIRCUIT_BREAKER_COOLDOWN_MS = 30000
let embeddingBreakerOpenUntil = 0

// Embedding cache: reuse embeddings for same query
const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>()
const EMBEDDING_CACHE_TTL = 180000 // 3 minutes

// ============================================================================
// TYPES
// ============================================================================

interface SearchBudget {
  totalMs: number
  startTime: number
  getRemainingMs(): number
}

interface WorkspaceSearchResult {
  workspaceId: string
  results: SearchResult[]
  ftsMs: number
  vectorMs: number
  topScore: number
}

interface EmbeddingState {
  value: number[] | null
}

interface AbortableController {
  controller: AbortController
  dispose(): void
}

// ============================================================================
// ENTITY EXTRACTION & RERANKING
// ============================================================================

// Canonical entities extracted from uploaded resource cards
// These are common event/topic names that users query about
const KNOWN_ENTITIES = [
  'active meeting', 'actives meeting', 'active', 'actives',
  'big little', 'big/little', 'bl', 'big little appreciation', 'bla',
  'ae summons', 'alpha epsilon summons', 'ae', 'alpha epsilon',
  'im futsal', 'intramural futsal', 'futsal',
  'study hall', 'study session',
  'gm', 'general meeting', 'chapter meeting',
  'social', 'mixer', 'philanthropy'
]

/**
 * Extract known entities from a query string
 * Returns normalized entity strings that appear in the query
 */
function extractEntities(query: string): string[] {
  const normalized = query.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  
  return KNOWN_ENTITIES.filter(entity => {
    const entityNorm = entity.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ')
    return normalized.includes(entityNorm)
  })
}

/**
 * Rerank search results to prefer:
 * 1. Exact entity match in title
 * 2. Resource type priority (event > faq > doc > link)
 * 3. Raw search score
 */
function rerankResults(results: SearchResult[], query: string): SearchResult[] {
  const entities = extractEntities(query)
  
  return results.sort((a, b) => {
    // 1. Exact entity match in title
    const aTitle = (a.title || '').toLowerCase()
    const bTitle = (b.title || '').toLowerCase()
    const aMatch = entities.some(e => aTitle.includes(e))
    const bMatch = entities.some(e => bTitle.includes(e))
    if (aMatch && !bMatch) return -1
    if (!aMatch && bMatch) return 1
    
    // 2. Type priority
    const typePriority: Record<string, number> = {
      event: 4,
      faq: 3,
      doc: 2,
      form: 1,
      link: 0
    }
    const aPri = typePriority[a.type] || 0
    const bPri = typePriority[b.type] || 0
    if (aPri !== bPri) return bPri - aPri
    
    // 3. Score
    return (b.score || 0) - (a.score || 0)
  })
}

// ============================================================================
// UTILITIES
// ============================================================================

function createBudget(totalMs: number): SearchBudget {
  const startTime = Date.now()
  return {
    totalMs,
    startTime,
    getRemainingMs() {
      return Math.max(0, this.totalMs - (Date.now() - this.startTime))
    }
  }
}

function isEmbeddingEnabled(): boolean {
  const now = Date.now()
  if (now < embeddingBreakerOpenUntil) {
    return false
  }

  const recentFailures = embeddingFailures.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS)
  embeddingFailures.length = 0
  embeddingFailures.push(...recentFailures)
  return recentFailures.length < CIRCUIT_BREAKER_THRESHOLD
}

function recordEmbeddingFailure(): void {
  const now = Date.now()
  embeddingFailures.push(now)
  const recentFailures = embeddingFailures.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS)
  if (recentFailures.length >= CIRCUIT_BREAKER_THRESHOLD) {
    embeddingBreakerOpenUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS
    console.warn('[Search V2] Embedding circuit breaker OPEN (temporarily disabling embeddings)')
    embeddingFailures.length = 0
  }
}

function createScopedController(parent?: AbortSignal): AbortableController {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (parent) {
    if (parent.aborted) {
      controller.abort()
    } else {
      parent.addEventListener('abort', onAbort)
    }
  }
  return {
    controller,
    dispose() {
      if (parent) {
        parent.removeEventListener('abort', onAbort)
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getCachedEmbedding(query: string, budget: SearchBudget): Promise<number[] | null> {
  const normalizedQuery = query.toLowerCase().trim()
  const cached = embeddingCache.get(normalizedQuery)
  
  if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL) {
    console.log('[Search V2] Using cached embedding')
    return cached.embedding
  }
  
  // Check if we have enough budget and embedding is enabled
  if (budget.getRemainingMs() < SMS_EMBED_MIN_REMAINING_MS) {
    console.log(`[Search V2] Insufficient budget for embedding (${budget.getRemainingMs()}ms < ${SMS_EMBED_MIN_REMAINING_MS}ms)`)
    return null
  }
  
  if (!isEmbeddingEnabled()) {
    console.warn('[Search V2] Embeddings disabled by circuit breaker')
    return null
  }
  
  try {
    for (let attempt = 0; attempt <= EMBEDDING_RETRY_DELAYS_MS.length; attempt++) {
      const attemptLabel = attempt + 1
      console.log(`[Search V2] Generating embedding (attempt ${attemptLabel}) with ${SMS_EMBED_TIMEOUT_MS}ms timeout`)
      try {
        const embedding = await Promise.race([
          embedText(query),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Embedding timeout')), SMS_EMBED_TIMEOUT_MS)
          )
        ])

        if (!embedding) {
          console.error('[Search V2] Embedding generation returned null')
          recordEmbeddingFailure()
          return null
        }

        embeddingBreakerOpenUntil = 0
        embeddingFailures.length = 0

        console.log(`[Search V2] Embedding generated (${embedding.length} dims)`)
        embeddingCache.set(normalizedQuery, { embedding, timestamp: Date.now() })
        return embedding
      } catch (err: any) {
        recordEmbeddingFailure()
        console.error(`[Search V2] Embedding attempt ${attemptLabel} failed:`, err?.message || err)
        const backoff = EMBEDDING_RETRY_DELAYS_MS[attempt]
        if (backoff) {
          await sleep(backoff)
          continue
        }
        return null
      }
    }
  } catch (err: any) {
    console.error('[Search V2] Embedding failed unexpectedly:', err?.message || err)
    recordEmbeddingFailure()
    return null
  }

  return null
}

// ============================================================================
// FTS SEARCH (using proper RPC)
// ============================================================================

async function searchLexicalFallback(
  query: string,
  spaceId: string,
  limit: number,
  offset: number = 0
): Promise<SearchResult[]> {
  const client = supabaseAdmin || supabase
  if (!client) {
    console.error('[Search V2] No Supabase client for lexical fallback')
    return []
  }

  const simplified = query.toLowerCase().replace(/[^\w\s]/g, ' ').trim()
  const tokens = simplified.split(/\s+/).filter(t => t.length > 2)
  
  // Use simple ilike search only (no similarity operator to avoid PostgREST syntax errors)
  const ilikePattern = tokens.length > 0 ? `%${tokens.join('%')}%` : `%${simplified}%`

  try {
    const { data, error } = await client
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*)
      `)
      .eq('space_id', spaceId)
      .or(`title.ilike.${ilikePattern},body.ilike.${ilikePattern}`)
      .order('updated_at', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[Search V2] Lexical fallback failed:', error)
      return []
    }

    return (data || []).map((resource: Record<string, unknown>) => ({
      ...resource,
      tags: (resource.tags as Array<{ tag: Record<string, unknown> }>)?.map(rt => rt.tag).filter(Boolean) || [],
      rank: 0.5,
      score: 0.5,
      source: 'lexical'
    })) as SearchResult[]
  } catch (err) {
    console.error('[Search V2] Lexical fallback exception:', err)
    return []
  }
}

async function searchFTS(
  query: string,
  spaceId: string,
  budget: SearchBudget,
  limit: number = 10,
  abortSignal?: AbortSignal
): Promise<SearchResult[]> {
  // BYPASS FTS RPC entirely due to hanging issues - go straight to lexical
  console.log(`[Search V2 FTS] Using lexical search for "${query}" in space ${spaceId.substring(0, 8)}...`)
  return searchLexicalFallback(query, spaceId, limit)
}

// ============================================================================
// VECTOR SEARCH
// ============================================================================

async function searchVector(
  embedding: number[],
  spaceId: string,
  budget: SearchBudget,
  limit: number = 10,
  abortSignal?: AbortSignal
): Promise<SearchResult[]> {
  const client = supabaseAdmin || supabase
  if (!client) {
    console.error('[Search V2 Vector] No Supabase client available')
    return []
  }
  
  const timeoutMs = Math.min(SMS_VECTOR_TIMEOUT_MS, budget.getRemainingMs())
  if (timeoutMs < 100) {
    console.log('[Search V2 Vector] Insufficient budget, skipping')
    return []
  }
  
  console.log(`[Search V2 Vector] Searching space ${spaceId.substring(0, 8)}... (timeout: ${timeoutMs}ms)`)
  
  const scoped = createScopedController(abortSignal)
  const controller = scoped.controller
  const hardTimeout = Math.min(timeoutMs, SMS_VECTOR_HARD_TIMEOUT_MS)
  const timeoutId = setTimeout(() => controller.abort(), hardTimeout)
  
  try {
    if (controller.signal.aborted) {
      console.warn('[Search V2 Vector] Skipping due to aborted signal before start')
      return []
    }
    const { data, error } = await client
      .rpc('search_resources_vector', {
        query_embedding: embedding,
        target_space_id: spaceId,
        limit_count: limit,
        offset_count: 0,
        target_user_id: null
      })
      .abortSignal(controller.signal)
    
    clearTimeout(timeoutId)
    scoped.dispose()
    
    if (error) {
      console.error('[Search V2 Vector] RPC error:', error.message)
      return []
    }
    
    const results = (data || []).map((hit: any) => ({
      ...hit,
      tags: [],
      score: typeof hit.similarity === 'number' ? hit.similarity : 0,
      source: 'vector'
    } as SearchResult))
    
    console.log(`[Search V2 Vector] Found ${results.length} results, top score: ${results[0]?.score?.toFixed(3) || 'N/A'}`)
    return results
    
  } catch (err: any) {
    clearTimeout(timeoutId)
    scoped.dispose()
    if (err?.name === 'AbortError') {
      console.warn('[Search V2 Vector] Hard timeout reached, skipping workspace')
    } else {
      console.error('[Search V2 Vector] Error:', err?.message || err)
    }
    return []
  }
}

// ============================================================================
// SEQUENTIAL WORKSPACE SEARCH
// ============================================================================

async function searchWorkspace(
  query: string,
  workspaceId: string,
  embeddingState: EmbeddingState,
  embeddingPromise: Promise<number[] | null> | null,
  budget: SearchBudget,
  abortSignal?: AbortSignal
): Promise<WorkspaceSearchResult> {
  const wsStart = Date.now()
  console.log(`[Search V2] Searching workspace ${workspaceId.substring(0, 8)}... (budget: ${budget.getRemainingMs()}ms)`)
  
  // Step 1: FTS search
  const ftsStart = Date.now()
  if (abortSignal?.aborted) {
    console.warn('[Search V2] Workspace search aborted before FTS')
    return {
      workspaceId,
      results: [],
      ftsMs: 0,
      vectorMs: 0,
      topScore: 0
    }
  }
  let ftsResults = await searchFTS(query, workspaceId, budget, 8)
  if (ftsResults.length === 0) {
    const expanded = expandFtsQuery(query)
    if (expanded !== query) {
      console.log('[Search V2] FTS returned no results, retrying with expanded query')
      ftsResults = await searchFTS(expanded, workspaceId, budget, 8)
    }

    if (ftsResults.length === 0) {
      console.log('[Search V2] FTS still empty after expansion, using lexical fallback')
      const fallbackResults = await searchLexicalFallback(query, workspaceId, 8)
      ftsResults = fallbackResults
    }
  }
  const ftsMs = Date.now() - ftsStart

  // Log top FTS score so we can observe confidence
  const topFtsScore = ftsResults[0]?.score || 0
  if (topFtsScore > 0) {
    console.log(`[Search V2] FTS top score: ${topFtsScore.toFixed(3)} in ${workspaceId.substring(0, 8)}`)
  }

  if (ftsResults.length > 0 && topFtsScore >= SMS_FTS_CONFIDENCE_THRESHOLD) {
    const totalMs = Date.now() - wsStart
    console.log(`[Search V2] FTS high confidence (${topFtsScore.toFixed(3)}), skipping vector for ${workspaceId.substring(0, 8)} (total ${totalMs}ms)`)
    return {
      workspaceId,
      results: ftsResults,
      ftsMs,
      vectorMs: 0,
      topScore: topFtsScore
    }
  }

  // Step 2: Vector search (if we have embedding and budget)
  let vectorResults: SearchResult[] = []
  let vectorMs = 0

  let embedding = embeddingState.value

  if (!embedding && embeddingPromise) {
    const remaining = budget.getRemainingMs()
    const waitBudget = Math.max(0, remaining - (SMS_VECTOR_TIMEOUT_MS + 100))
    if (SMS_WAIT_FOR_EMBED_MS > 0 && waitBudget > 0) {
      const waitMs = Math.min(SMS_WAIT_FOR_EMBED_MS, waitBudget)
      console.log(`[Search V2] Waiting up to ${waitMs}ms for embedding before vector search`)
      embedding = await Promise.race([
        embeddingPromise,
        new Promise<number[] | null>(resolve => setTimeout(() => resolve(null), waitMs))
      ])
      if (embedding) {
        embeddingState.value = embedding
      }
    }
  }
  
  if (embedding !== null && budget.getRemainingMs() > (SMS_VECTOR_TIMEOUT_MS + 100) && !abortSignal?.aborted) {
    const vectorStart = Date.now()
    vectorResults = await searchVector(embedding, workspaceId, budget, 5, abortSignal)
    vectorMs = Date.now() - vectorStart
  } else {
    console.log('[Search V2] Skipping vector search (no embedding or insufficient budget)')
  }
  
  // Merge and deduplicate results
  const allResults = [...ftsResults, ...vectorResults]
  const seen = new Set<string>()
  const deduped: SearchResult[] = []
  
  for (const result of allResults) {
    if (!seen.has(result.id)) {
      seen.add(result.id)
      deduped.push(result)
    }
  }
  
  // Sort by score
  deduped.sort((a, b) => (b.score || 0) - (a.score || 0))
  
  const topScore = deduped[0]?.score || 0
  const totalMs = Date.now() - wsStart
  
  console.log(`[Search V2] Workspace ${workspaceId.substring(0, 8)} complete in ${totalMs}ms (FTS: ${ftsMs}ms, Vector: ${vectorMs}ms, results: ${deduped.length}, top: ${topScore.toFixed(3)})`)
  
  return {
    workspaceId,
    results: deduped,
    ftsMs,
    vectorMs,
    topScore
  }
}

// ============================================================================
// MAIN HYBRID SEARCH
// ============================================================================

export async function hybridSearchV2(
  query: string,
  workspaceIds: string[],
  options: {
    budgetMs?: number
    highConfidenceThreshold?: number
    abortSignal?: AbortSignal
    traceId?: string
  } = {}
): Promise<SearchResult[]> {
  const {
    budgetMs = SMS_SEARCH_BUDGET_MS,
    highConfidenceThreshold = 0.75,
    abortSignal,
    traceId
  } = options
  
  const budget = createBudget(budgetMs)
  const searchId = traceId ? `${traceId}` : `search_${Date.now()}_${Math.random().toString(36).substring(7)}`
  
  console.log(`[Search V2] [${searchId}] Starting hybrid search`)
  console.log(`[Search V2] [${searchId}] Query: "${query}"`)
  console.log(`[Search V2] [${searchId}] Workspaces: ${workspaceIds.length}`)
  console.log(`[Search V2] [${searchId}] Budget: ${budgetMs}ms`)
  
  if (!query.trim()) {
    console.log('[Search V2] Empty query, returning empty results')
    return []
  }
  
  if (workspaceIds.length === 0) {
    console.log('[Search V2] No workspaces provided, returning empty results')
    return []
  }
  
  const queryTokens = new Set(normalize(query).split(' '))
  
  // Step 1: DISABLE embedding generation for SMS - use pre-computed only
  const embeddingState: EmbeddingState = { value: null }
  let embeddingPromise: Promise<number[] | null> | null = null
  const normalizedQuery = query.toLowerCase().trim()
  const cachedEntry = embeddingCache.get(normalizedQuery)
  
  if (cachedEntry && Date.now() - cachedEntry.timestamp < EMBEDDING_CACHE_TTL) {
    embeddingState.value = cachedEntry.embedding
    console.log(`[Search V2] [${searchId}] Embedding: cached (budget: ${budget.getRemainingMs()}ms)`)
  } else {
    console.log(`[Search V2] [${searchId}] Skipping live embedding generation (use pre-computed only)`)
  }
  
  // Step 2: Search workspaces sequentially (FTS first, then vector if embedding ready)
  const workspaceResults: WorkspaceSearchResult[] = []
  
  for (const workspaceId of workspaceIds) {
    if (budget.getRemainingMs() < 500 || abortSignal?.aborted) {
      console.log(`[Search V2] [${searchId}] Budget exhausted, stopping at ${workspaceResults.length}/${workspaceIds.length} workspaces`)
      break
    }
    
    const wsResult = await searchWorkspace(query, workspaceId, embeddingState, embeddingPromise, budget, abortSignal)
    workspaceResults.push(wsResult)
    
    // Continue searching all workspaces (no early exit)
    // We'll rerank results globally after collecting from all sources
  }
  
  // Step 3: Aggregate and rank results
  const allResults: SearchResult[] = []
  for (const wsResult of workspaceResults) {
    allResults.push(...wsResult.results)
  }
  
  // Deduplicate by ID
  const seen = new Set<string>()
  const deduped: SearchResult[] = []
  for (const result of allResults) {
    if (!seen.has(result.id)) {
      seen.add(result.id)
      deduped.push(result)
    }
  }

  if (deduped.length > 0) {
    const preview = deduped.slice(0, 5).map((hit) => {
      const spaceId = (hit as any)?.space_id as string | undefined
      const source = ((hit as any)?.source || 'unknown').toString().toLowerCase()
      const score = typeof hit.score === 'number' ? hit.score.toFixed(3) : 'n/a'
      return `${hit.title || 'untitled'} [score=${score}, source=${source}, space=${spaceId?.substring(0, 8) || 'n/a'}]`
    })
    console.log(`[Search V2] [${searchId}] Pre-rerank top hits:`, preview)
  } else {
    console.log(`[Search V2] [${searchId}] No hits returned across searched workspaces`)
  }

  // Apply entity-based reranking (entity match > type priority > score)
  const reranked = rerankResults(deduped, query)
  
  // Log extracted entities and reranking effect
  const entities = extractEntities(query)
  if (entities.length > 0) {
    console.log(`[Search V2] [${searchId}] Extracted entities:`, entities)
  }
  if (reranked.length > 0 && reranked[0].id !== deduped[0]?.id) {
    console.log(`[Search V2] [${searchId}] Reranking changed top result: "${deduped[0]?.title}" → "${reranked[0]?.title}"`)
  }
  
  const totalMs = Date.now() - budget.startTime
  console.log(`[Search V2] [${searchId}] Complete in ${totalMs}ms`)
  console.log(`[Search V2] [${searchId}] Results: ${reranked.length} (top score: ${reranked[0]?.score?.toFixed(3) || 'N/A'})`)
  console.log(`[Search V2] [${searchId}] Top result: "${reranked[0]?.title}" (type: ${reranked[0]?.type})`)
  console.log(`[Search V2] [${searchId}] Workspaces searched: ${workspaceResults.length}/${workspaceIds.length}`)
  
  return reranked.slice(0, 10) // Return top 10
}

// ============================================================================
// EXPORTS
// ============================================================================

export { getCachedEmbedding, isEmbeddingEnabled }

function computeWeight(result: SearchResult, queryTokens: Set<string>): number {
  let weight = typeof result.score === 'number' ? result.score : 0
  const source = ((result as any)?.source || '').toString().toLowerCase()
  if (source.includes('resource') || source.includes('card')) {
    weight += 0.2
  }
  const title = (result.title || '').toLowerCase()
  for (const token of queryTokens) {
    if (token && title.includes(token)) {
      weight += 0.05
    }
  }
  const text = `${title} ${(result as any)?.subtitle || ''}`.toLowerCase()
  if (/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text)) {
    weight += 0.1
  }
  if (/(am|pm)/i.test(text)) {
    weight += 0.05
  }
  if (title.includes('summons') || title.includes('meeting') || title.includes('big little') || title.includes('futsal')) {
    weight += 0.05
  }
  return weight
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const FTS_SYNONYMS: Array<{ match: RegExp; expansions: string[] }> = [
  {
    match: /\bbig\s+little\b/i,
    expansions: ['"big/little"', '"big & little"', '"family reveal"']
  }
]

function expandFtsQuery(query: string): string {
  let expanded = query
  for (const { match, expansions } of FTS_SYNONYMS) {
    if (match.test(query)) {
      expanded += ' ' + expansions.join(' ')
    }
  }
  return expanded
}

