/**
 * Reranking and Fusion
 * Combines BM25 (keyword) and Vector (semantic) search with Reciprocal Rank Fusion
 */

import { SearchResult } from './database.types'

// ============================================================================
// RECIPROCAL RANK FUSION (RRF)
// ============================================================================

/**
 * Reciprocal Rank Fusion
 * Combines multiple ranked lists into a single ranking
 * 
 * Formula: score = sum(1 / (k + rank_i)) for each list
 * where k is a constant (typically 60) and rank_i is the rank in list i
 */
export function reciprocalRankFusion(
  rankedLists: SearchResult[][],
  k: number = 60
): SearchResult[] {
  // Build score map
  const scoreMap = new Map<string, { result: SearchResult; rrfScore: number; ranks: number[] }>()

  // Process each ranked list
  rankedLists.forEach((list, listIndex) => {
    list.forEach((result, rank) => {
      const existing = scoreMap.get(result.id)
      
      if (existing) {
        // Add to existing score
        existing.rrfScore += 1 / (k + rank + 1)
        existing.ranks.push(rank + 1)
      } else {
        // Create new entry
        scoreMap.set(result.id, {
          result,
          rrfScore: 1 / (k + rank + 1),
          ranks: [rank + 1]
        })
      }
    })
  })

  // Convert to array and sort by RRF score
  const fusedResults = Array.from(scoreMap.values())
    .map(({ result, rrfScore, ranks }) => ({
      ...result,
      rrfScore,
      ranks,
      // Combine RRF with original scores
      fusedScore: 0.6 * (result.score || 0) + 0.4 * rrfScore
    }))
    .sort((a, b) => b.fusedScore - a.fusedScore)

  return fusedResults
}

// ============================================================================
// SCORE FUSION
// ============================================================================

/**
 * Fuse BM25 and Vector scores with weights
 */
export function fuseScores(
  bm25Results: SearchResult[],
  vectorResults: SearchResult[],
  bm25Weight: number = 0.4,
  vectorWeight: number = 0.6
): SearchResult[] {
  const resultMap = new Map<string, SearchResult>()

  // Normalize BM25 scores (0-1 range)
  const maxBM25 = Math.max(...bm25Results.map(r => r.score || 0), 1)
  const normalizedBM25 = bm25Results.map(r => ({
    ...r,
    normalizedScore: (r.score || 0) / maxBM25
  }))

  // Normalize vector scores (already 0-1 typically)
  const normalizedVector = vectorResults.map(r => ({
    ...r,
    normalizedScore: r.score || 0
  }))

  // Merge BM25 results
  for (const result of normalizedBM25) {
    resultMap.set(result.id, {
      ...result,
      fusedScore: bm25Weight * result.normalizedScore
    })
  }

  // Merge vector results
  for (const result of normalizedVector) {
    const existing = resultMap.get(result.id)
    
    if (existing) {
      existing.fusedScore = (existing.fusedScore || 0) + vectorWeight * result.normalizedScore
    } else {
      resultMap.set(result.id, {
        ...result,
        fusedScore: vectorWeight * result.normalizedScore
      })
    }
  }

  // Sort by fused score
  return Array.from(resultMap.values())
    .sort((a, b) => (b.fusedScore || 0) - (a.fusedScore || 0))
}

// ============================================================================
// TIME DECAY
// ============================================================================

/**
 * Apply time decay to search results
 * Recent results get boosted
 * 
 * Formula: time_decay = exp(-days_old / half_life_days)
 */
export function applyTimeDecay(
  results: SearchResult[],
  halfLifeDays: number = 90
): SearchResult[] {
  const now = new Date()

  return results.map(result => {
    const updatedAt = new Date(result.updated_at)
    const daysOld = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
    const timeDecay = Math.exp(-daysOld / halfLifeDays)

    return {
      ...result,
      timeDecay,
      // Boost score with time decay
      boostedScore: (result.fusedScore || result.score || 0) * (0.8 + 0.2 * timeDecay)
    }
  })
}

// ============================================================================
// AUTHORITY SCORING
// ============================================================================

export interface AuthorityConfig {
  roles: Record<string, number>  // role -> boost
  channels: Record<string, number>  // channel -> boost
  sources: Record<string, number>  // source type -> boost
}

const DEFAULT_AUTHORITY: AuthorityConfig = {
  roles: {
    'president': 0.15,
    'vp-professional': 0.12,
    'vp-social': 0.12,
    'vp-finance': 0.12,
    'secretary': 0.10,
    'officer': 0.08,
    'active': 0.05,
    'pledge': 0.02
  },
  channels: {
    'announcements': 0.10,
    'general': 0.05,
    'officers': 0.08,
    'random': 0.0
  },
  sources: {
    'gdoc': 0.10,  // Official documents
    'upload': 0.08,
    'gcal': 0.12,  // Calendar events are authoritative
    'slack': 0.03
  }
}

/**
 * Apply authority scoring based on source, author, channel
 */
export function applyAuthorityScoring(
  results: SearchResult[],
  config: AuthorityConfig = DEFAULT_AUTHORITY
): SearchResult[] {
  return results.map(result => {
    let authorityBoost = 0

    // Source type boost
    if (result.source && config.sources[result.source]) {
      authorityBoost += config.sources[result.source]
    }

    // Channel boost (for Slack messages)
    if (result.metadata?.channel_name) {
      const channelBoost = config.channels[result.metadata.channel_name] || 0
      authorityBoost += channelBoost
    }

    // Role boost (if we have author info)
    // TODO: Look up author role from person table
    
    return {
      ...result,
      authorityBoost,
      finalScore: (result.boostedScore || result.fusedScore || result.score || 0) + authorityBoost
    }
  })
}

// ============================================================================
// COMPLETE RERANKING PIPELINE
// ============================================================================

/**
 * Complete reranking pipeline:
 * 1. Fuse BM25 + Vector with RRF
 * 2. Apply time decay
 * 3. Apply authority scoring
 * 4. Sort by final score
 */
export function rerankResults(
  bm25Results: SearchResult[],
  vectorResults: SearchResult[],
  options: {
    bm25Weight?: number
    vectorWeight?: number
    halfLifeDays?: number
    authorityConfig?: AuthorityConfig
  } = {}
): SearchResult[] {
  const {
    bm25Weight = 0.4,
    vectorWeight = 0.6,
    halfLifeDays = 90,
    authorityConfig = DEFAULT_AUTHORITY
  } = options

  console.log(`[Reranker] Reranking ${bm25Results.length} BM25 + ${vectorResults.length} vector results`)

  // Step 1: Fuse scores
  let results = fuseScores(bm25Results, vectorResults, bm25Weight, vectorWeight)
  console.log(`[Reranker] After fusion: ${results.length} results`)

  // Step 2: Apply time decay
  results = applyTimeDecay(results, halfLifeDays)
  console.log(`[Reranker] After time decay: top score = ${results[0]?.boostedScore?.toFixed(3)}`)

  // Step 3: Apply authority scoring
  results = applyAuthorityScoring(results, authorityConfig)
  console.log(`[Reranker] After authority: top score = ${results[0]?.finalScore?.toFixed(3)}`)

  // Step 4: Sort by final score
  results.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))

  // Log top 5
  console.log(`[Reranker] Top 5 results:`)
  results.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.title} (final: ${r.finalScore?.toFixed(3)}, time: ${r.timeDecay?.toFixed(3)}, auth: ${r.authorityBoost?.toFixed(3)})`)
  })

  return results
}

// ============================================================================
// CROSS-ENCODER RERANKING (Optional, for future)
// ============================================================================

/**
 * Placeholder for cross-encoder reranking
 * Would use a model like bge-reranker-large to rerank top-k results
 * 
 * For now, just returns the top results unchanged
 */
export async function crossEncoderRerank(
  query: string,
  results: SearchResult[],
  topK: number = 50
): Promise<SearchResult[]> {
  // TODO: Implement cross-encoder reranking
  // This would call a reranker model API to get more precise rankings
  // For now, just return top-k results
  
  console.log(`[Reranker] Cross-encoder reranking not implemented, returning top ${topK}`)
  return results.slice(0, topK)
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get rank of a result in a list
 */
export function getRank(resultId: string, results: SearchResult[]): number {
  const index = results.findIndex(r => r.id === resultId)
  return index === -1 ? results.length : index
}

/**
 * Normalize scores to 0-1 range
 */
export function normalizeScores(results: SearchResult[]): SearchResult[] {
  const maxScore = Math.max(...results.map(r => r.score || 0), 1)
  
  return results.map(r => ({
    ...r,
    normalizedScore: (r.score || 0) / maxScore
  }))
}

/**
 * Calculate diversity score (penalize similar results)
 */
export function applyDiversityPenalty(
  results: SearchResult[],
  similarityThreshold: number = 0.9
): SearchResult[] {
  const seen = new Set<string>()
  
  return results.map(result => {
    // Simple diversity: penalize if title is very similar to previous results
    const titleWords = new Set(result.title.toLowerCase().split(/\s+/))
    let diversityPenalty = 0
    
    for (const seenTitle of seen) {
      const seenWords = new Set(seenTitle.toLowerCase().split(/\s+/))
      const intersection = new Set([...titleWords].filter(w => seenWords.has(w)))
      const union = new Set([...titleWords, ...seenWords])
      const similarity = intersection.size / union.size
      
      if (similarity > similarityThreshold) {
        diversityPenalty += 0.1
      }
    }
    
    seen.add(result.title)
    
    return {
      ...result,
      diversityPenalty,
      finalScore: (result.finalScore || result.score || 0) - diversityPenalty
    }
  })
}

