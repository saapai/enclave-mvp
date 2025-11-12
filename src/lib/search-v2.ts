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

const SMS_SEARCH_BUDGET_MS = Number(process.env.SMS_SEARCH_BUDGET_MS || '20000') // 20s total budget
const SMS_FTS_TIMEOUT_MS = Number(process.env.SMS_FTS_TIMEOUT_MS || '2500') // 2.5s per FTS attempt
const SMS_EMBED_TIMEOUT_MS = Number(process.env.SMS_EMBED_TIMEOUT_MS || '9000') // 9s for embedding
const SMS_VECTOR_TIMEOUT_MS = Number(process.env.SMS_VECTOR_TIMEOUT_MS || '4000') // 4s per vector
const SMS_EMBED_MIN_REMAINING_MS = Number(process.env.SMS_EMBED_MIN_REMAINING_MS || '3000') // Need 3s left to embed
const SMS_FTS_HARD_TIMEOUT_MS = Number(process.env.SMS_FTS_HARD_TIMEOUT_MS || '2400')
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
const queryEmbeddingCache = new Map<string, { query: string; embedding: number[]; completedAt: number }>()
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

function isAbortError(err: any): boolean {
  if (!err) return false
  return err.name === 'AbortError' || err.message === 'This operation was aborted'
}

// ============================================================================
// FTS SEARCH (using proper RPC)
// ============================================================================

async function searchLexicalFallback(
  query: string,
  spaceId: string,
  limit: number,
  budget?: SearchBudget,
  abortSignal?: AbortSignal
): Promise<SearchResult[]> {
  const client = supabaseAdmin || supabase
  if (!client) {
    console.error('[Search V2] No Supabase client for lexical fallback')
    return []
  }

  // Extract meaningful keywords from query (remove stop words)
  const stopWords = new Set(['when', 'is', 'are', 'was', 'were', 'what', 'where', 'who', 'how', 'which', 'the', 'a', 'an', 'do', 'does', 'did'])
  const simplified = query.toLowerCase().replace(/[^\w\s]/g, ' ').trim()
  const tokens = simplified.split(/\s+/)
    .filter(t => t.length >= 2 && !stopWords.has(t))
  
  if (tokens.length === 0) {
    console.log('[Search V2] Lexical fallback: no meaningful tokens after filtering')
    return []
  }
  
  // Prefer longer tokens to avoid broad scans on short fragments like "ae"
  const sortedTokens = [...tokens].sort((a, b) => b.length - a.length)
  const primaryToken = sortedTokens.find(token => token.length >= 3) || sortedTokens[0]
  
  const queryStart = Date.now()
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (abortSignal?.aborted) {
      console.warn('[Search V2] Lexical fallback skipped because parent signal already aborted')
      return []
    }

    const attemptStart = Date.now()
    const scoped = createScopedController(abortSignal)
    const controller = scoped.controller
    const remainingBudget = budget ? budget.getRemainingMs() : SMS_FTS_TIMEOUT_MS + 250
    const attemptTimeout = Math.max(500, Math.min(SMS_FTS_TIMEOUT_MS, remainingBudget - 100))
    const hardTimeout = Math.min(attemptTimeout, SMS_FTS_HARD_TIMEOUT_MS)
    const timeoutId = setTimeout(() => controller.abort(), hardTimeout)

    try {
      const { data, error } = await client
        .from('resource')
        .select('id,space_id,type,title,body,url,created_by,created_at,updated_at')
        .eq('space_id', spaceId)
        .or(`title.ilike.%${primaryToken}%,body.ilike.%${primaryToken}%`)
        .order('updated_at', { ascending: false })
        .limit(limit * 2)
        .abortSignal(controller.signal)

      clearTimeout(timeoutId)
      scoped.dispose()

      const durationMs = Date.now() - attemptStart

      if (error) {
        console.error(`[Search V2] Lexical fallback attempt ${attempt} failed:`, error, `(duration: ${durationMs}ms)`)
        if (attempt < maxAttempts) {
          await sleep(200 * attempt)
          continue
        }
        return []
      }

      if (!data || data.length === 0) {
        console.log(`[Search V2] Lexical fallback returned no rows in ${durationMs}ms`)
        return []
      }

      // Post-filter: prefer results that match multiple tokens
      const results = data.map((resource: Record<string, unknown>) => {
        const titleLower = (resource.title as string || '').toLowerCase()
        const bodyLower = (resource.body as string || '').toLowerCase()
        
        // Count how many tokens match
        let matchCount = 0
        for (const token of tokens) {
          if (titleLower.includes(token) || bodyLower.includes(token)) {
            matchCount++
          }
        }
        
        // Boost score based on match count
        const score = 0.3 + (matchCount / tokens.length) * 0.7
        
        return {
          ...resource,
          tags: [], // Skip tags for speed
          rank: score,
          score: score,
          source: 'lexical'
        }
      })

      // Sort by score and return top results
      results.sort((a, b) => (b.score || 0) - (a.score || 0))
      console.log(`[Search V2] Lexical fallback succeeded in ${durationMs}ms (rows: ${results.length})`)
      return results.slice(0, limit) as SearchResult[]

    } catch (err) {
      clearTimeout(timeoutId)
      scoped.dispose()

      const durationMs = Date.now() - attemptStart

      if (isAbortError(err)) {
        console.warn(`[Search V2] Lexical fallback aborted on attempt ${attempt} after ${durationMs}ms`)
        return []
      }

      console.error(`[Search V2] Lexical fallback attempt ${attempt} exception:`, err, `(duration: ${durationMs}ms)`)
      if (attempt < maxAttempts) {
        await sleep(200 * attempt)
        continue
      }
      return []
    }
  }

  const durationMs = Date.now() - queryStart
  console.warn(`[Search V2] Lexical fallback exhausted attempts after ${durationMs}ms`)
  return []
}

async function searchFTS(
  query: string,
  spaceId: string,
  budget: SearchBudget,
  limit: number = 10,
  abortSignal?: AbortSignal
): Promise<SearchResult[]> {
  const client = supabaseAdmin || supabase
  if (!client) {
    console.error('[Search V2 FTS] No Supabase client available')
    return []
  }

  const scoped = createScopedController(abortSignal)
  const controller = scoped.controller
  const remainingBudget = budget.getRemainingMs()
  const attemptTimeout = Math.max(500, Math.min(SMS_FTS_TIMEOUT_MS, remainingBudget - 100))
  const hardTimeout = Math.min(attemptTimeout, SMS_FTS_HARD_TIMEOUT_MS)
  const timeoutId = setTimeout(() => controller.abort(), hardTimeout)

  console.log(`[Search V2 FTS] RPC start for "${query}" (space ${spaceId.substring(0, 8)}, timeout ${hardTimeout}ms)`)

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
    scoped.dispose()

    if (error) {
      console.error('[Search V2 FTS] RPC error:', error.message || error)
      return searchLexicalFallback(query, spaceId, limit, budget, abortSignal)
    }

    if (!data || data.length === 0) {
      console.log('[Search V2 FTS] No rows returned, falling back to lexical search')
      return searchLexicalFallback(query, spaceId, limit, budget, abortSignal)
    }

    const results = data.map((row: any) => ({
      ...row,
      tags: [],
      score: typeof row.rank === 'number' ? row.rank : 0,
      source: 'fts'
    } as SearchResult))

    console.log(`[Search V2 FTS] Returned ${results.length} rows (top score: ${results[0]?.score?.toFixed(3) || 'N/A'})`)
    return results

  } catch (err) {
    clearTimeout(timeoutId)
    scoped.dispose()

    if (isAbortError(err)) {
      console.warn('[Search V2 FTS] Aborted due to timeout, switching to lexical fallback')
    } else {
      console.error('[Search V2 FTS] Exception:', err)
    }
    return searchLexicalFallback(query, spaceId, limit, budget, abortSignal)
  }
}

// ============================================================================
// VECTOR SEARCH (CHUNK-BASED for better granularity)
// ============================================================================

async function searchVectorChunks(
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
  
  console.log(`[Search V2 Vector] Searching chunks in space ${spaceId.substring(0, 8)}... (timeout: ${timeoutMs}ms)`)
  
  const scoped = createScopedController(abortSignal)
  const controller = scoped.controller
  const hardTimeout = Math.min(timeoutMs, SMS_VECTOR_HARD_TIMEOUT_MS)
  const timeoutId = setTimeout(() => controller.abort(), hardTimeout)
  
  try {
    if (controller.signal.aborted) {
      console.warn('[Search V2 Vector] Skipping due to aborted signal before start')
      return []
    }
    
    // First, try chunk-based search for better granularity
    const { data: chunkData, error: chunkError } = await client
      .rpc('search_resource_chunks_vector', {
        query_embedding: embedding,
        target_space_id: spaceId,
        limit_count: limit * 2, // Get more chunks, then dedupe by resource
        offset_count: 0
      })
      .abortSignal(controller.signal)
    
    clearTimeout(timeoutId)
    scoped.dispose()
    
    if (chunkError) {
      console.error('[Search V2 Vector] Chunk RPC error:', chunkError.message)
      // Fall back to resource-level search
      return searchVectorResources(embedding, spaceId, budget, limit, abortSignal)
    }
    
    if (!chunkData || chunkData.length === 0) {
      console.log('[Search V2 Vector] No chunks found, trying resource-level search')
      return searchVectorResources(embedding, spaceId, budget, limit, abortSignal)
    }
    
    // Group chunks by resource_id and take the best score
    const resourceScores = new Map<string, number>()
    const resourceChunks = new Map<string, any[]>()
    
    for (const chunk of chunkData) {
      const resourceId = chunk.resource_id
      const score = chunk.score || 0
      
      if (!resourceScores.has(resourceId) || score > resourceScores.get(resourceId)!) {
        resourceScores.set(resourceId, score)
      }
      
      if (!resourceChunks.has(resourceId)) {
        resourceChunks.set(resourceId, [])
      }
      resourceChunks.get(resourceId)!.push(chunk)
    }
    
    // Fetch full resource data for top matches
    const topResourceIds = Array.from(resourceScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id)
    
    const { data: resources, error: resourceError } = await client
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*)
      `)
      .in('id', topResourceIds)
    
    if (resourceError || !resources) {
      console.error('[Search V2 Vector] Error fetching resources:', resourceError)
      return []
    }
    
    const results = resources.map((resource: any) => ({
      ...resource,
      tags: (resource.tags as Array<{ tag: Record<string, unknown> }>)?.map(rt => rt.tag).filter(Boolean) || [],
      score: resourceScores.get(resource.id) || 0,
      source: 'vector-chunk'
    } as SearchResult))
    
    // Sort by score
    results.sort((a, b) => (b.score || 0) - (a.score || 0))
    
    console.log(`[Search V2 Vector] Found ${results.length} resources from ${chunkData.length} chunks, top score: ${results[0]?.score?.toFixed(3) || 'N/A'}`)
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

// Fallback: resource-level vector search
async function searchVectorResources(
  embedding: number[],
  spaceId: string,
  budget: SearchBudget,
  limit: number = 10,
  abortSignal?: AbortSignal
): Promise<SearchResult[]> {
  const client = supabaseAdmin || supabase
  if (!client) {
    return []
  }
  
  const scoped = createScopedController(abortSignal)
  const controller = scoped.controller
  const timeoutMs = Math.min(SMS_VECTOR_TIMEOUT_MS, budget.getRemainingMs())
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  
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
    scoped.dispose()
    
    if (error) {
      console.error('[Search V2 Vector] Resource RPC error:', error.message)
      return []
    }
    
    const results = (data || []).map((hit: any) => ({
      ...hit,
      tags: [],
      score: typeof hit.similarity === 'number' ? hit.similarity : 0,
      source: 'vector'
    } as SearchResult))
    
    console.log(`[Search V2 Vector] Found ${results.length} resources, top score: ${results[0]?.score?.toFixed(3) || 'N/A'}`)
    return results
    
  } catch (err: any) {
    clearTimeout(timeoutId)
    scoped.dispose()
    return []
  }
}

// Main vector search entry point (uses chunks for better granularity)
async function searchVector(
  embedding: number[],
  spaceId: string,
  budget: SearchBudget,
  limit: number = 10,
  abortSignal?: AbortSignal
): Promise<SearchResult[]> {
  return searchVectorChunks(embedding, spaceId, budget, limit, abortSignal)
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
  let ftsResults = await searchFTS(query, workspaceId, budget, 8, abortSignal)
  if (ftsResults.length === 0) {
    const expanded = expandFtsQuery(query)
    if (expanded !== query) {
      console.log('[Search V2] FTS returned no results, retrying with expanded query')
      ftsResults = await searchFTS(expanded, workspaceId, budget, 8, abortSignal)
    }

    if (ftsResults.length === 0) {
      console.log('[Search V2] FTS still empty after expansion, using lexical fallback')
      const fallbackResults = await searchLexicalFallback(query, workspaceId, 8, budget, abortSignal)
      ftsResults = fallbackResults
    }
  }
  const ftsMs = Date.now() - ftsStart

  // Log top FTS score so we can observe confidence
  const topFtsScore = ftsResults[0]?.score || 0
  if (topFtsScore > 0) {
    console.log(`[Search V2] FTS top score: ${topFtsScore.toFixed(3)} in ${workspaceId.substring(0, 8)}`)
  }

  const ftsHighConfidence = ftsResults.length > 0 && topFtsScore >= SMS_FTS_CONFIDENCE_THRESHOLD
  if (ftsHighConfidence && !embeddingState.value && !embeddingPromise) {
    const totalMs = Date.now() - wsStart
    console.log(`[Search V2] FTS high confidence (${topFtsScore.toFixed(3)}), no embedding available; returning lexical results (total ${totalMs}ms)`) 
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

  let embeddingToUse = embeddingState.value

  if (!embeddingToUse && embeddingPromise) {
    const remaining = budget.getRemainingMs()
    const waitBudget = Math.max(0, remaining - (SMS_VECTOR_TIMEOUT_MS + 100))
    if (SMS_WAIT_FOR_EMBED_MS > 0 && waitBudget > 0) {
      const waitMs = Math.min(SMS_WAIT_FOR_EMBED_MS, waitBudget)
      console.log(`[Search V2] Waiting up to ${waitMs}ms for embedding before vector search`)
      embeddingToUse = await Promise.race([
        embeddingPromise,
        new Promise<number[] | null>(resolve => setTimeout(() => resolve(null), waitMs))
      ])
      if (embeddingToUse) {
        embeddingState.value = embeddingToUse
      }
    }
  }

  if (!embeddingToUse && embeddingPromise) {
    embeddingToUse = await embeddingPromise
    if (embeddingToUse) {
      embeddingState.value = embeddingToUse
    }
  }
  
  if (embeddingToUse && budget.getRemainingMs() > (SMS_VECTOR_TIMEOUT_MS + 100) && !abortSignal?.aborted) {
    const vectorStart = Date.now()
    vectorResults = await searchVector(embeddingToUse, workspaceId, budget, 5, abortSignal)
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
  
  // Step 1: Use cached embeddings only for search (don't block on generation)
  const embeddingState: EmbeddingState = { value: null }
  let embeddingPromise: Promise<number[] | null> | null = null
  const normalizedQuery = query.toLowerCase().trim()
  const recentEmbeddingEntry = queryEmbeddingCache.get(normalizedQuery)

  const cachedEntry = embeddingCache.get(normalizedQuery)
  
  if (recentEmbeddingEntry && Date.now() - recentEmbeddingEntry.completedAt < EMBEDDING_CACHE_TTL) {
    embeddingState.value = recentEmbeddingEntry.embedding
    console.log(`[Search V2] [${searchId}] Embedding: recent cache hit (budget: ${budget.getRemainingMs()}ms)`)
  } else if (cachedEntry && Date.now() - cachedEntry.timestamp < EMBEDDING_CACHE_TTL) {
    embeddingState.value = cachedEntry.embedding
    console.log(`[Search V2] [${searchId}] Embedding: cached (budget: ${budget.getRemainingMs()}ms)`)
  } else {
    console.log(`[Search V2] [${searchId}] No cached embedding available for this query`)
    embeddingPromise = getCachedEmbedding(query, budget).then(embedding => {
      if (embedding) {
        embeddingCache.set(normalizedQuery, { embedding, timestamp: Date.now() })
        queryEmbeddingCache.set(normalizedQuery, { query, embedding, completedAt: Date.now() })
      }
      return embedding
    }).catch(err => {
      console.error('[Search V2] Embedding generation failed:', err)
      return null
    })
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
  
  if (embeddingState.value) {
    queryEmbeddingCache.set(normalizedQuery, {
      query,
      embedding: embeddingState.value,
      completedAt: Date.now()
    })
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

