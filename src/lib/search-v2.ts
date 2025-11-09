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

const SMS_SEARCH_BUDGET_MS = Number(process.env.SMS_SEARCH_BUDGET_MS || '8000') // 8s total (reduced now that OpenAI is fast)
const SMS_FTS_TIMEOUT_MS = Number(process.env.SMS_FTS_TIMEOUT_MS || '800') // 800ms per FTS
const SMS_EMBED_TIMEOUT_MS = Number(process.env.SMS_EMBED_TIMEOUT_MS || '2000') // 2s for embedding (OpenAI is fast ~200-500ms)
const SMS_VECTOR_TIMEOUT_MS = Number(process.env.SMS_VECTOR_TIMEOUT_MS || '1200') // 1.2s per vector
const SMS_EMBED_MIN_REMAINING_MS = Number(process.env.SMS_EMBED_MIN_REMAINING_MS || '2500') // Need 2.5s left to embed (slightly more than timeout)
const SMS_FTS_HARD_TIMEOUT_MS = Number(process.env.SMS_FTS_HARD_TIMEOUT_MS || '350')
const SMS_VECTOR_HARD_TIMEOUT_MS = Number(process.env.SMS_VECTOR_HARD_TIMEOUT_MS || '600')

// Circuit breaker: if embedding fails 3 times in 5 min, disable for next queries
const embeddingFailures: number[] = []
const CIRCUIT_BREAKER_WINDOW_MS = 300000 // 5 minutes
const CIRCUIT_BREAKER_THRESHOLD = 3 // Increased from 2 to be more tolerant

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
  // Clean old failures
  const now = Date.now()
  const recentFailures = embeddingFailures.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS)
  embeddingFailures.length = 0
  embeddingFailures.push(...recentFailures)
  
  const enabled = recentFailures.length < CIRCUIT_BREAKER_THRESHOLD
  if (!enabled) {
    console.log('[Search V2] Embedding circuit breaker OPEN (too many recent failures)')
  }
  return enabled
}

function recordEmbeddingFailure(): void {
  embeddingFailures.push(Date.now())
  console.log(`[Search V2] Recorded embedding failure (${embeddingFailures.length} recent failures)`)
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
    return null
  }
  
  try {
    console.log(`[Search V2] Generating embedding with ${SMS_EMBED_TIMEOUT_MS}ms timeout`)
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
    
    console.log(`[Search V2] Embedding generated (${embedding.length} dims)`)
    embeddingCache.set(normalizedQuery, { embedding, timestamp: Date.now() })
    return embedding
  } catch (err: any) {
    console.error('[Search V2] Embedding failed:', err.message)
    recordEmbeddingFailure()
    return null
  }
}

// ============================================================================
// FTS SEARCH (using proper RPC)
// ============================================================================

async function searchFTS(
  query: string,
  spaceId: string,
  budget: SearchBudget,
  limit: number = 10
): Promise<SearchResult[]> {
  const client = supabaseAdmin || supabase
  if (!client) {
    console.error('[Search V2 FTS] No Supabase client available')
    return []
  }
  
  const timeoutMs = Math.min(SMS_FTS_TIMEOUT_MS, budget.getRemainingMs())
  if (timeoutMs < 100) {
    console.log('[Search V2 FTS] Insufficient budget, skipping')
    return []
  }
  
  console.log(`[Search V2 FTS] Searching "${query}" in space ${spaceId.substring(0, 8)}... (timeout: ${timeoutMs}ms)`)
  
  const controller = new AbortController()
  const hardTimeout = Math.min(timeoutMs, SMS_FTS_HARD_TIMEOUT_MS)
  const timeoutId = setTimeout(() => controller.abort(), hardTimeout)
  
  try {
    const { data, error } = await client
      .rpc('search_resources_fts', {
        search_query: query,
        target_space_id: spaceId,
        limit_count: limit,
        offset_count: 0
      })
      .abortSignal(controller.signal)
    
    clearTimeout(timeoutId)
    
    if (error) {
      console.error('[Search V2 FTS] RPC error:', error.message)
      return []
    }
    
    const results = (data || []).map((hit: any) => ({
      ...hit,
      tags: [],
      score: Math.min(1.0, (hit.rank || 0) * 10 + 0.3),
      source: 'fts'
    } as SearchResult))
    
    console.log(`[Search V2 FTS] Found ${results.length} results, top score: ${results[0]?.score?.toFixed(3) || 'N/A'}`)
    return results
    
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err?.name === 'AbortError') {
      console.warn('[Search V2 FTS] Hard timeout reached, skipping workspace')
    } else {
      console.error('[Search V2 FTS] Error:', err?.message || err)
    }
    return []
  }
}

// ============================================================================
// VECTOR SEARCH
// ============================================================================

async function searchVector(
  embedding: number[],
  spaceId: string,
  budget: SearchBudget,
  limit: number = 10
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
  
  const controller = new AbortController()
  const hardTimeout = Math.min(timeoutMs, SMS_VECTOR_HARD_TIMEOUT_MS)
  const timeoutId = setTimeout(() => controller.abort(), hardTimeout)
  
  try {
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
  budget: SearchBudget
): Promise<WorkspaceSearchResult> {
  const wsStart = Date.now()
  console.log(`[Search V2] Searching workspace ${workspaceId.substring(0, 8)}... (budget: ${budget.getRemainingMs()}ms)`)
  
  // Step 1: FTS search
  const ftsStart = Date.now()
  const ftsResults = await searchFTS(query, workspaceId, budget, 5)
  const ftsMs = Date.now() - ftsStart
  
  // Step 2: Vector search (if we have embedding and budget)
  let vectorResults: SearchResult[] = []
  let vectorMs = 0

  let embedding = embeddingState.value

  if (!embedding && embeddingPromise) {
    const remaining = budget.getRemainingMs()
    const waitBudget = Math.max(0, remaining - (SMS_VECTOR_TIMEOUT_MS + 100))
    if (waitBudget > 0) {
      const waitMs = Math.min(500, waitBudget)
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
  
  if (embedding !== null && budget.getRemainingMs() > (SMS_VECTOR_TIMEOUT_MS + 100)) {
    const vectorStart = Date.now()
    vectorResults = await searchVector(embedding, workspaceId, budget, 5)
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
  } = {}
): Promise<SearchResult[]> {
  const {
    budgetMs = SMS_SEARCH_BUDGET_MS,
    highConfidenceThreshold = 0.75
  } = options
  
  const budget = createBudget(budgetMs)
  const searchId = `search_${Date.now()}_${Math.random().toString(36).substring(7)}`
  
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
  
  // Step 1: Start embedding generation in background (non-blocking)
  const embeddingState: EmbeddingState = { value: null }
  let embeddingPromise: Promise<number[] | null> | null = null
  const normalizedQuery = query.toLowerCase().trim()
  const cachedEntry = embeddingCache.get(normalizedQuery)
  
  if (cachedEntry && Date.now() - cachedEntry.timestamp < EMBEDDING_CACHE_TTL) {
    embeddingState.value = cachedEntry.embedding
    console.log(`[Search V2] [${searchId}] Embedding: cached (budget: ${budget.getRemainingMs()}ms)`)
  } else if (budget.getRemainingMs() > SMS_EMBED_MIN_REMAINING_MS) {
    console.log(`[Search V2] [${searchId}] Starting embedding generation in background`)
    embeddingPromise = getCachedEmbedding(query, budget)
    if (embeddingPromise) {
      embeddingPromise
        .then(result => {
          if (result) {
            embeddingState.value = result
          }
          return result
        })
        .catch(err => {
          console.error('[Search V2] Background embedding failed:', err?.message || err)
        })
    }
  } else {
    console.log(`[Search V2] [${searchId}] Skipping embedding (insufficient budget: ${budget.getRemainingMs()}ms)`)
  }
  
  // Step 2: Search workspaces sequentially (FTS first, then vector if embedding ready)
  const workspaceResults: WorkspaceSearchResult[] = []
  
  for (const workspaceId of workspaceIds) {
    if (budget.getRemainingMs() < 500) {
      console.log(`[Search V2] [${searchId}] Budget exhausted, stopping at ${workspaceResults.length}/${workspaceIds.length} workspaces`)
      break
    }
    
    const wsResult = await searchWorkspace(query, workspaceId, embeddingState, embeddingPromise, budget)
    workspaceResults.push(wsResult)
    
    // Early exit if we found a high-confidence result
    if (wsResult.topScore >= highConfidenceThreshold) {
      console.log(`[Search V2] [${searchId}] High-confidence result found (${wsResult.topScore.toFixed(3)}), stopping search`)
      break
    }
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
  
  // Sort by score
  deduped.sort((a, b) => (b.score || 0) - (a.score || 0))
  
  const totalMs = Date.now() - budget.startTime
  console.log(`[Search V2] [${searchId}] Complete in ${totalMs}ms`)
  console.log(`[Search V2] [${searchId}] Results: ${deduped.length} (top score: ${deduped[0]?.score?.toFixed(3) || 'N/A'})`)
  console.log(`[Search V2] [${searchId}] Workspaces searched: ${workspaceResults.length}/${workspaceIds.length}`)
  
  return deduped.slice(0, 10) // Return top 10
}

// ============================================================================
// EXPORTS
// ============================================================================

export { getCachedEmbedding, isEmbeddingEnabled }

