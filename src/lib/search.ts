import { supabase, supabaseAdmin } from './supabase'
import { embedText } from './embeddings'
import { searchSlackMessages } from './slack'
import { rerankResults } from './reranker'
import { pTimeout } from './utils'

interface ResourceTag {
  name: string | null
}

export type SearchResult = Record<string, any>

export type ResourceWithTags = Record<string, any>

// Use admin client for vector searches to bypass RLS (user auth validated at API level)
// Regular client used for standard queries with user context
const searchClient = supabaseAdmin!

// Feature flag: Enable reranking with time decay + authority
const USE_RERANKING = process.env.USE_RERANKING === 'true'

const DEFAULT_TIMEOUT_MS = Number(process.env.SEARCH_DEFAULT_TIMEOUT_MS || '1500') // Aggressive 1.5s default
const VECTOR_TIMEOUT_MS = Number(process.env.SEARCH_VECTOR_TIMEOUT_MS || '800') // 800ms for vector (often hangs)
const FTS_TIMEOUT_MS = Number(process.env.SEARCH_FTS_TIMEOUT_MS || '500') // 500ms for FTS
const CALENDAR_TIMEOUT_MS = Number(process.env.SEARCH_CALENDAR_TIMEOUT_MS || '800') // 800ms for calendar
const GDOC_TIMEOUT_MS = Number(process.env.SEARCH_GDOC_TIMEOUT_MS || '800') // 800ms for gdocs

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

async function runWithAbort<T>(
  label: string,
  timeoutMs: number,
  executor: (signal: AbortSignal) => Promise<T>
): Promise<T | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
    console.error(`[Hybrid Search] ${label} timed out after ${timeoutMs}ms`)
  }, timeoutMs)

  try {
    return await executor(controller.signal)
  } catch (err) {
    if (isAbortError(err)) {
      console.error(`[Hybrid Search] ${label} aborted due to timeout`)
      return null
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export interface SearchFilters {
  type?: string
  tags?: string[]
  from?: string
  to?: string
}

export interface SearchOptions {
  limit?: number
  offset?: number
}

// Hybrid search with pre-generated embedding (for multi-workspace searches)
export async function searchResourcesHybridWithEmbedding(
  query: string,
  spaceId: string,
  queryEmbedding: number[] | null,
  filters: SearchFilters = {},
  options: SearchOptions = {},
  userId?: string
): Promise<SearchResult[]> {
  const { limit = 20, offset = 0 } = options
  
  if (!query.trim()) {
    return searchResources(query, spaceId, filters, options, userId)
  }

  const searchStart = Date.now()
  const searchId = `${spaceId.substring(0, 8)}...`
  
  try {
    console.log(`[Hybrid Search] [${searchId}] START - query: "${query}", spaceId: ${spaceId}, pregenEmbed=${!!queryEmbedding}`)
    
    // Search regular resources with FTS (keyword search) FIRST
    const ftsStart = Date.now()
    console.log(`[Hybrid Search] [${searchId}] FTS:start`)
    const regularResults = await searchResources(query, spaceId, filters, { limit: limit * 2, offset: 0 }, userId)
    const ftsDuration = Date.now() - ftsStart
    console.log(`[Hybrid Search] [${searchId}] FTS:done (${ftsDuration}ms, ${regularResults.length} results)`)
    
    if (!queryEmbedding) {
      console.log(`[Hybrid Search] [${searchId}] No embedding, returning FTS only (${regularResults.length} results)`)
      return regularResults.slice(offset, offset + limit)
    }
    
    // Search regular resources with vector search (semantic search for PDFs, uploads, etc.)
    const vectorStart = Date.now()
    console.log(`[Hybrid Search] [${searchId}] VECTOR:start`)
    
    // For default workspace (personal), filter by user to ensure privacy
    // For custom workspaces, allow searching all resources in that workspace
    const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'
    const shouldFilterByUser = spaceId === DEFAULT_SPACE_ID
    
    let resourceVectorResults: any[] | null = null
    let vectorError: any = null
    
    try {
      const vectorResponse = await runWithAbort<{ data: any[] | null; error: any }>(
        'search_resources_vector',
        VECTOR_TIMEOUT_MS,
        (signal) =>
          (async () => {
            const res = await searchClient
              .rpc('search_resources_vector', {
                query_embedding: queryEmbedding,
                target_space_id: spaceId,
                limit_count: limit * 2,
                offset_count: 0,
                target_user_id: shouldFilterByUser ? userId : null // Filter by user only in personal workspace
              })
              .abortSignal(signal)
            return res as { data: any[] | null; error: any }
          })()
      )

      if (vectorResponse) {
        resourceVectorResults = vectorResponse.data
        vectorError = vectorResponse.error
      }
      
      const vectorDuration = Date.now() - vectorStart
      if (vectorError) {
        console.error(`[Hybrid Search] [${searchId}] VECTOR:error (${vectorDuration}ms):`, vectorError)
      } else {
        console.log(`[Hybrid Search] [${searchId}] VECTOR:done (${vectorDuration}ms, ${resourceVectorResults?.length || 0} matches)`)
        if (resourceVectorResults && resourceVectorResults.length > 0) {
          console.log(`[Hybrid Search] [${searchId}] VECTOR:top`, {
            title: resourceVectorResults[0].title,
            similarity: resourceVectorResults[0].similarity
          })
        }
      }
    } catch (err) {
      const vectorDuration = Date.now() - vectorStart
      console.error(`[Hybrid Search] [${searchId}] VECTOR:failed (${vectorDuration}ms):`, err)
    }
    
    // Convert vector search results to SearchResult format
    const vectorSearchResults: SearchResult[] = (resourceVectorResults || []).map((resource: any) => ({
      ...resource,
      tags: [],  // TODO: Fetch tags separately if needed
      rank: resource.similarity || 0,
      score: resource.similarity || 0
    } as SearchResult))
    
    // Search Google Docs chunks using admin client (pass userId for filtering)
    const gdocsStart = Date.now()
    console.log(`[Hybrid Search] [${searchId}] GDOCS:start`)
    
    // For default workspace (personal), filter by user to ensure privacy
    // For custom workspaces, allow searching all resources in that workspace
    const shouldFilterGoogleDocsByUser = spaceId === DEFAULT_SPACE_ID
    
    let googleDocsResults: any[] | null = null
    let gdError: any = null
    
    try {
      const gdocsResponse = await runWithAbort<{ data: any[] | null; error: any }>(
        'search_google_docs_vector',
        GDOC_TIMEOUT_MS,
        (signal) =>
          (async () => {
            const res = await searchClient
              .rpc('search_google_docs_vector', {
                query_embedding: queryEmbedding,
                target_space_id: spaceId,
                limit_count: limit * 2,
                offset_count: 0,
                target_user_id: shouldFilterGoogleDocsByUser ? userId : null
              })
              .abortSignal(signal)
            return res as { data: any[] | null; error: any }
          })()
      )
      
      if (gdocsResponse) {
        googleDocsResults = gdocsResponse.data
        gdError = gdocsResponse.error
      }
      
      const gdocsDuration = Date.now() - gdocsStart
      if (gdError) {
        console.error(`[Hybrid Search] [${searchId}] GDOCS:error (${gdocsDuration}ms):`, gdError)
      } else {
        console.log(`[Hybrid Search] [${searchId}] GDOCS:done (${gdocsDuration}ms, ${googleDocsResults?.length || 0} chunks)`)
        if (googleDocsResults && googleDocsResults.length > 0) {
          console.log(`[Hybrid Search] [${searchId}] GDOCS:top`, { 
            text_preview: googleDocsResults[0].text?.substring(0, 100), 
            added_by: googleDocsResults[0].added_by,
            similarity: googleDocsResults[0].similarity 
          })
        }
      }
    } catch (err) {
      const gdocsDuration = Date.now() - gdocsStart
      console.error(`[Hybrid Search] [${searchId}] GDOCS:failed (${gdocsDuration}ms):`, err)
    }

    // Search Calendar Events using admin client (pass userId for filtering)
    // For default workspace (personal), filter by user to ensure privacy
    // For custom workspaces, allow searching all events in that workspace
    const shouldFilterCalendarByUser = spaceId === DEFAULT_SPACE_ID
    
    let calendarResults: any[] | null = null
    let calError: any = null
    const calendarResponse = await runWithAbort<{ data: any[] | null; error: any }>(
      'search_calendar_events_vector',
      CALENDAR_TIMEOUT_MS,
      (signal) =>
        (async () => {
          const res = await searchClient
            .rpc('search_calendar_events_vector', {
              query_embedding: queryEmbedding,
              target_space_id: spaceId,
              limit_count: limit * 2,
              offset_count: 0,
              target_user_id: shouldFilterCalendarByUser ? userId : null
            })
            .abortSignal(signal)
          return res as { data: any[] | null; error: any }
        })()
    )

    if (calendarResponse) {
      calendarResults = calendarResponse.data
      calError = calendarResponse.error
    } else {
      console.warn(`[Calendar Search] RPC timed out for space ${spaceId}`)
    }

    if (calError) {
      console.error('Calendar search error:', calError)
    }

    // Search Slack messages
    const slackResults = await searchSlackMessages(
      queryEmbedding,
      spaceId,
      limit * 2
    )

    // No need to filter by userId here - already done in RPC
    // But keep this for backwards compatibility if RPC doesn't have target_user_id
    const userFilteredGoogleDocs = googleDocsResults || []
    console.log(`[GDocs Search] Final chunk count: ${userFilteredGoogleDocs.length}`)

    // Convert Google Docs results to SearchResult format
    const googleDocsSearchResults: SearchResult[] = userFilteredGoogleDocs.map((chunk: any) => ({
      id: `google_doc_${chunk.source_id}_${chunk.id}`,
      title: `Google Doc Chunk`,
      body: chunk.text,
      type: 'google_doc',
      source: 'gdoc',  // Add source for logging
      url: `https://docs.google.com/document/d/${chunk.source_id}/edit`,
      space_id: spaceId,
      created_at: chunk.created_at,
      updated_at: chunk.updated_at,
      created_by: chunk.added_by,
      tags: [],
      rank: chunk.similarity || 0,
      score: chunk.similarity || 0,
      metadata: {
        source_id: chunk.source_id,
        heading_path: chunk.heading_path,
        chunk_id: chunk.id
      }
    } as SearchResult))

    // Filter Calendar results by userId (since we bypassed RLS with admin client)
    const userFilteredCalendar = userId
      ? (calendarResults || []).filter((event: any) => event.added_by === userId)
      : (calendarResults || [])

    // Helper function to format dates with timezone information
    const formatDateTime = (dateStr: string, timezone?: string) => {
      const date = new Date(dateStr)
      const options: Intl.DateTimeFormatOptions = {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      }
      
      // If timezone is provided, use it; otherwise use the default
      if (timezone) {
        options.timeZone = timezone
      }
      
      return date.toLocaleString('en-US', options)
    }

    // Convert Calendar results to SearchResult format
    const calendarSearchResults: SearchResult[] = userFilteredCalendar.map((event: any) => {
      // Format start and end times
      const startDate = new Date(event.start_time)
      const endDate = new Date(event.end_time)
      const startFormatted = startDate.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
      const endFormatted = endDate.toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
      
      return {
        id: `calendar_event_${event.id}`,
        title: event.summary || 'Calendar Event',  // Fixed: use summary instead of title
        body: `${event.description || ''}\n\nWhen: ${startFormatted} - ${endFormatted}${event.location ? `\nWhere: ${event.location}` : ''}`,
        type: 'event',
        source: 'gcal',  // Add source for logging
        url: event.html_link,
        space_id: spaceId,
        created_at: event.created_at || new Date().toISOString(),
        updated_at: event.updated_at || new Date().toISOString(),
        created_by: event.added_by,
        tags: [],
        rank: event.similarity || 0,
        score: event.similarity || 0,
        metadata: {
          event_id: event.id,
          start_time: event.start_time,
          end_time: event.end_time,
          location: event.location,
          calendar_source_id: event.source_id
        }
      } as SearchResult
    })

    // Convert Slack results to SearchResult format
    const slackSearchResults: SearchResult[] = (slackResults || []).map((msg: any) => ({
      id: `slack_message_${msg.slack_message_id}`,
      title: msg.channel_context || 'Slack Message',
      body: msg.text,
      type: 'slack',
      source: 'slack',  // Add source for logging
      url: null, // TODO: Build Slack message permalink
      space_id: spaceId,
      created_at: msg.created_at,
      updated_at: msg.created_at,
      created_by: null,
      tags: [],
      rank: msg.similarity || 0,
      score: msg.similarity || 0,
      metadata: {
        slack_message_id: msg.slack_message_id,
        slack_channel_id: msg.slack_channel_id,
        thread_context: msg.thread_context,
        channel_context: msg.channel_context
      }
    } as SearchResult))

    // Combine and rank results from all sources
    const totalDuration = Date.now() - searchStart
    console.log(`[Hybrid Search] [${searchId}] COMPOSE:start (FTS:${regularResults.length}, Vector:${vectorSearchResults.length}, GDocs:${googleDocsSearchResults.length}, Calendar:${calendarSearchResults.length}, Slack:${slackSearchResults.length})`)
    
    // Filter out unwanted documents BEFORE reranking (e.g., deleted resources that still show up)
    const blockedTitles = ['fu\'s', 'fu\'s palace', 'f u\'s', 'f us palace'].map(t => t.toLowerCase())
    const filterBlocked = (results: SearchResult[]) => results.filter(result => {
      const titleLower = (result.title || '').toLowerCase()
      return !blockedTitles.some(blocked => titleLower.includes(blocked))
    })
    
    const filteredRegular = filterBlocked(regularResults)
    const filteredVector = filterBlocked(vectorSearchResults)
    const filteredGDocs = filterBlocked(googleDocsSearchResults)
    const filteredCalendar = filterBlocked(calendarSearchResults)
    const filteredSlack = filterBlocked(slackSearchResults)
    
    let allResults = [...filteredRegular, ...filteredVector, ...filteredGDocs, ...filteredCalendar, ...filteredSlack]
    
    // Apply reranking if enabled
    if (USE_RERANKING && filteredRegular.length > 0 && filteredVector.length > 0) {
      console.log(`[Hybrid Search] Applying reranking (time decay + authority)`)
      
      // Separate BM25 (FTS) and Vector results for reranking (already filtered)
      const bm25Results = filteredRegular
      const vectorOnlyResults = filteredVector
      
      // Rerank with time decay + authority
      const reranked = rerankResults(bm25Results, vectorOnlyResults, {
        bm25Weight: 0.4,
        vectorWeight: 0.6,
        halfLifeDays: 90
      })
      
      // Merge with other sources (GDocs, Calendar, Slack)
      allResults = [...reranked, ...filteredGDocs, ...filteredCalendar, ...filteredSlack]
      
      // Sort by final score (from reranker) or fallback to original score
      allResults.sort((a, b) => {
        const scoreA = (a as any).finalScore || a.score || 0
        const scoreB = (b as any).finalScore || b.score || 0
        return scoreB - scoreA
      })
    } else {
      // Simple sort by score/rank (old behavior)
      allResults.sort((a, b) => (b.score || 0) - (a.score || 0))
    }
    
    const composeDuration = Date.now() - searchStart
    console.log(`[Hybrid Search] [${searchId}] COMPOSE:done (${composeDuration}ms total)`)
    console.log(`[Hybrid Search] [${searchId}] Top 5 results:`)
    allResults.slice(0, 5).forEach((result, i) => {
      const finalScore = (result as any).finalScore
      const scoreDisplay = finalScore ? `final: ${finalScore.toFixed(3)}` : `score: ${result.score?.toFixed(3)}`
      console.log(`[Hybrid Search] [${searchId}]   ${i+1}. [${result.type}] ${result.title} (${scoreDisplay}, source: ${(result as any).source})`)
    })
    
    // Apply limit and offset
    const finalResults = allResults.slice(offset, offset + limit)
    console.log(`[Hybrid Search] [${searchId}] DONE (${Date.now() - searchStart}ms total, returning ${finalResults.length} results)`)
    return finalResults
    
  } catch (error) {
    console.error('Hybrid search error:', error)
    // Fallback to regular search (with user filtering)
    return searchResources(query, spaceId, filters, options, userId)
  }
}

// Original hybrid search that generates its own embedding (for single-workspace searches)
export async function searchResourcesHybrid(
  query: string,
  spaceId: string,
  filters: SearchFilters = {},
  options: SearchOptions = {},
  userId?: string
): Promise<SearchResult[]> {
  const { limit = 20, offset = 0 } = options
  
  if (!query.trim()) {
    return searchResources(query, spaceId, filters, options, userId)
  }

  const searchId = `${spaceId.substring(0, 8)}...`
  
  // Generate embedding inline
  const embedStart = Date.now()
  console.log(`[Hybrid Search] [${searchId}] EMBED:start`)
  let queryEmbedding: number[] | null = null
  try {
    queryEmbedding = await pTimeout(
      embedText(query),
      3000, // 3s timeout for embedding (inline fallback, aggressive)
      `embed:${searchId}`
    )
    const embedDuration = Date.now() - embedStart
    console.log(`[Hybrid Search] [${searchId}] EMBED:done (${embedDuration}ms, dims=${queryEmbedding?.length || 0})`)
  } catch (err) {
    const embedDuration = Date.now() - embedStart
    const isTimeout = err instanceof Error && err.message.includes('timeout')
    console.error(`[Hybrid Search] [${searchId}] EMBED:${isTimeout ? 'timeout' : 'failed'} (${embedDuration}ms)`)
  }
  
  // Delegate to the with-embedding version
  return searchResourcesHybridWithEmbedding(query, spaceId, queryEmbedding, filters, options, userId)
}

export async function searchResources(
  query: string,
  spaceId: string,
  filters: SearchFilters = {},
  options: SearchOptions = {},
  userId?: string
): Promise<SearchResult[]> {
  const { limit = 20, offset = 0 } = options

  // Use admin client to bypass RLS (auth validated at API level)
  const dbClient = supabaseAdmin || supabase

  // Build the base query (used only for non-search listing)
  let supabaseQuery = dbClient
    .from('resource')
    .select(`
      *,
      tags:resource_tag(
        tag:tag(*)
      ),
      event_meta(*)
    `)
    .eq('space_id', spaceId)
  
  // Filter by user if provided
  if (userId) {
    supabaseQuery = supabaseQuery.eq('created_by', userId)
  }

  // Apply type filter
  if (filters.type) {
    supabaseQuery = supabaseQuery.eq('type', filters.type)
  }

  // Apply date range filter for events
  if (filters.from || filters.to) {
    supabaseQuery = supabaseQuery
      .gte('updated_at', filters.from || '1900-01-01')
      .lte('updated_at', filters.to || '2100-01-01')
  }

  // Apply tag filters - simplified for now
  // TODO: Implement proper tag filtering

  if (query.trim()) {
    // Use Postgres full-text search function for ranked results
    // Use admin client and filter by userId manually since auth.uid() doesn't work with Clerk
    console.log(`[FTS Search] Query: "${query}", Space: ${spaceId}, User: ${userId}`)
    
    // First, check what resources exist in the database
    if (process.env.SEARCH_DEBUG === 'true') {
      const { data: allResources, error: checkError } = await dbClient
        .from('resource')
        .select('id, title, body, created_by, source, type')
        .eq('space_id', spaceId)
        .limit(200)
      
      if (checkError) {
        console.error('[FTS Search] Resource inventory check failed:', checkError)
      } else {
        console.log(`[FTS Search] Total resources in DB: ${allResources?.length || 0}`)
        if (allResources && allResources.length > 0) {
          console.log(`[FTS Search] Resources by source:`, allResources.reduce((acc: any, r: any) => {
            acc[r.source] = (acc[r.source] || 0) + 1
            return acc
          }, {}))
          const userResources = allResources.filter((r: any) => r.created_by === userId)
          console.log(`[FTS Search] User's resources: ${userResources.length}`)
          if (userResources.length > 0) {
            console.log(`[FTS Search] User resource titles:`, userResources.map((r: any) => r.title))
          }
        }
      }
    }
    
    console.log(`[FTS Search] Calling RPC with query: "${query}"`)
    
    // For default workspace (personal), filter by user to ensure privacy
    // For custom workspaces, allow searching all resources in that workspace
    const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'
    const shouldFilterByUser = spaceId === DEFAULT_SPACE_ID
    
    // CRITICAL: Skip RPC entirely - it's hanging in Postgres
    // Use direct ilike query instead
    console.log(`[FTS Search] BYPASSING RPC - using direct ilike query`)
    let hits: any[] | null = null
    let rpcError: any = null
    
    try {
      const ilikeStart = Date.now()
      const ilikeResponse = await runWithAbort<{ data: any[] | null; error: any }>(
        'fts_ilike_direct',
        1500,
        (signal) =>
          (async () => {
            const res = await (dbClient as any)
              .from('resource')
              .select('*')
              .eq('space_id', spaceId)
              .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
              .limit(limit)
              .range(offset, offset + limit - 1)
              .abortSignal(signal)
            return res as { data: any[] | null; error: any }
          })()
      )
      
      const ilikeDuration = Date.now() - ilikeStart
      if (!ilikeResponse) {
        console.warn(`[FTS Search] Direct ilike timed out after ${ilikeDuration}ms`)
        rpcError = new Error('timeout:fts_ilike_direct')
      } else {
        console.log(`[FTS Search] Direct ilike completed in ${ilikeDuration}ms, returned ${ilikeResponse.data?.length || 0} results`)
        if (ilikeResponse.error) {
          console.error('[FTS Search] Direct ilike error:', ilikeResponse.error)
          rpcError = ilikeResponse.error
        } else {
          hits = (ilikeResponse.data || []).map((r: any) => ({ ...r, rank: 0.5 }))
        }
      }
    } catch (err) {
      console.error('[FTS Search] Direct ilike failed:', err)
      rpcError = err
    }
    
    // Direct ilike results already populated in hits variable above
    
    console.log(`[FTS Search] Query response:`, {
      hitCount: hits?.length,
      error: rpcError,
      firstHit: hits?.[0] ? { id: hits[0].id, title: hits[0].title, rank: hits[0].rank } : null
    })

    if (rpcError || !hits || hits.length === 0) {
      if (rpcError) {
        console.error('[FTS Search] Query error:', rpcError)
      }
      console.log('[FTS Search] No results found, returning empty')
      return []
    }

    console.log(`[FTS Search] Raw hits: ${hits?.length || 0}`)
    if (hits && hits.length > 0) {
      console.log(`[FTS Search] First hit:`, { id: hits[0].id, title: hits[0].title, created_by: hits[0].created_by })
    }

    // Filter by the specific workspace (spaceId) that was passed to the search
    // The search is already filtered by spaceId in the RPC call, but double-check here
    let filteredHits = (hits || []).filter((hit: any) => {
      return hit.space_id === spaceId
    })
    
    console.log(`[FTS Search] Filtered by workspace ${spaceId}: ${hits?.length || 0} -> ${filteredHits.length}`)
    
    const ids = filteredHits.map((h: any) => h.id as string)
    console.log(`[FTS Search] Final resource IDs:`, ids)
    if (ids.length === 0) {
      console.log(`[FTS Search] No results found in workspace ${spaceId}`)
      return []
    }

    // Fetch relationship-expanded records using admin client
    const { data: resources, error } = await dbClient
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*)
      `)
      .in('id', ids)

    if (error) {
      console.error('Search expand error:', error)
      return []
    }

    const idToRank: Record<string, { rank: number; score: number; order: number }> = {}
    ids.forEach((id: string, idx: number) => {
      const hit = (hits as any[]).find((h) => h.id === id)
      // Boost FTS scores to be competitive with vector similarity scores (typically 0.5-0.8)
      // FTS rank is usually 0-0.1, so multiply by 10 to get 0-1 range, then add 0.3 base boost
      const rawRank = (hit?.rank as number) || 0
      const boostedScore = Math.min(1.0, (rawRank * 10) + 0.3)
      idToRank[id] = { rank: rawRank, score: boostedScore, order: idx }
      console.log(`[FTS Scoring] Resource "${hit?.title}" - raw rank: ${rawRank.toFixed(4)}, boosted score: ${boostedScore.toFixed(3)}`)
    })

    const mapped = (resources || []).map((resource: Record<string, unknown>) => ({
      ...resource,
      tags: (resource.tags as Array<{ tag: Record<string, unknown> }>)?.map((rt) => rt.tag).filter(Boolean) || [],
      rank: idToRank[(resource as any).id]?.rank ?? 0,
      score: idToRank[(resource as any).id]?.score ?? 0
    })) as SearchResult[]

    // Sort to preserve FTS order
    return mapped.sort((a, b) => (idToRank[a.id].order - idToRank[b.id].order))
  } else {
    // No search query, just return filtered results
    const { data: resources, error } = await supabaseQuery
      .order('updated_at', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Query error:', error)
      return []
    }

    // Transform the data to match SearchResult interface
    return (resources || []).map((resource: Record<string, unknown>) => ({
      ...resource,
      tags: (resource.tags as Array<{ tag: Record<string, unknown> }>)?.map((rt) => rt.tag).filter(Boolean) || [],
      rank: 1,
      score: 1
    })) as SearchResult[]
  }
}

export async function logQuery(
  spaceId: string,
  userId: string,
  query: string,
  resultsCount: number,
  _clickedResourceId?: string
) {
  // Temporarily disable query logging to avoid foreign key constraint issues
  // TODO: Fix the foreign key constraints and re-enable logging
  console.log(`Query logged: "${query}" - ${resultsCount} results`)
}

export async function updateQuerySatisfaction(
  queryId: string,
  satisfaction: 'thumbs_up' | 'thumbs_down'
) {
  // For now, just log the satisfaction - we'll implement this later
  console.log(`Query ${queryId} satisfaction: ${satisfaction}`)
}

// Helper function to extract searchable text from a resource
export function getSearchableText(resource: ResourceWithTags): string {
  const parts = [resource.title]
  
  if (resource.body) {
    parts.push(resource.body)
  }
  
  if (resource.tags) {
    const tagsArray = Array.isArray(resource.tags) ? resource.tags : []
    const tagNames = tagsArray
      .map((tag: ResourceTag | null) => tag?.name ?? '')
      .filter((tagName: string) => tagName.length > 0)
    if (tagNames.length > 0) {
      parts.push(tagNames.join(' '))
    }
  }
  
  if (resource.event_meta?.location) {
    parts.push(resource.event_meta.location)
  }
  
  return parts.join(' ').toLowerCase()
}

// Helper function to calculate freshness score
export function calculateFreshnessScore(resource: ResourceWithTags): number {
  const now = new Date()
  const updatedAt = new Date(resource.updated_at)
  const ageDays = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
  
  // Exponential decay: score *= exp(-age_days/60)
  return Math.exp(-ageDays / 60)
}

// Helper function to calculate type intent boost
export function calculateTypeIntentBoost(query: string, resourceType: string): number {
  const queryLower = query.toLowerCase()
  
  // Event-related keywords
  if (resourceType === 'event' && 
      (queryLower.includes('when') || queryLower.includes('where') || 
       queryLower.includes('time') || queryLower.includes('date'))) {
    return 0.4
  }
  
  // Form-related keywords
  if (resourceType === 'form' && 
      (queryLower.includes('form') || queryLower.includes('apply') || 
       queryLower.includes('submit') || queryLower.includes('register'))) {
    return 0.4
  }
  
  return 0
}
