import { supabase, supabaseAdmin } from './supabase'
import { ResourceWithTags, SearchResult } from './database.types'
import { embedText } from './embeddings'
import { searchSlackMessages } from './slack'

// Use admin client for vector searches to bypass RLS (user auth validated at API level)
// Regular client used for standard queries with user context
const searchClient = supabaseAdmin!

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

// Hybrid search that includes regular resources, Google Docs, and Slack messages
export async function searchResourcesHybrid(
  query: string,
  spaceId: string,
  filters: SearchFilters = {},
  options: SearchOptions = {},
  userId?: string
): Promise<SearchResult[]> {
  const { limit = 20, offset = 0 } = options
  
  if (!query.trim()) {
    // Return regular resources only for empty queries
    return searchResources(query, spaceId, filters, options, userId)
  }

  try {
    // Generate embedding for vector search
    const queryEmbedding = await embedText(query)
    
    // Search regular resources (with user filtering)
    const regularResults = await searchResources(query, spaceId, filters, { limit: limit * 2, offset: 0 }, userId)
    
    // Search Google Docs chunks using admin client (pass userId for filtering)
    console.log(`[GDocs Search] Searching for Google Doc chunks - Space: ${spaceId}, User: ${userId}`)
    const { data: googleDocsResults, error: gdError } = await searchClient
      .rpc('search_google_docs_vector', {
        query_embedding: queryEmbedding,
        target_space_id: spaceId,
        limit_count: limit * 2,
        offset_count: 0,
        target_user_id: userId || null  // CRITICAL: Pass userId to RPC for filtering
      })

    if (gdError) {
      console.error('[GDocs Search] RPC error:', gdError)
    } else {
      console.log(`[GDocs Search] RPC returned ${googleDocsResults?.length || 0} chunks`)
      if (googleDocsResults && googleDocsResults.length > 0) {
        console.log(`[GDocs Search] First chunk:`, { 
          text_preview: googleDocsResults[0].text?.substring(0, 100), 
          added_by: googleDocsResults[0].added_by,
          similarity: googleDocsResults[0].similarity 
        })
      }
    }

    // Search Calendar Events using admin client (pass userId for filtering)
    const { data: calendarResults, error: calError } = await searchClient
      .rpc('search_calendar_events_vector', {
        query_embedding: queryEmbedding,
        target_space_id: spaceId,
        limit_count: limit * 2,
        offset_count: 0,
        target_user_id: userId || null
      })

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
      // Format start and end times with their respective timezones
      const startFormatted = formatDateTime(event.start_time, event.start_timezone)
      const endFormatted = formatDateTime(event.end_time, event.end_timezone)
      
      return {
        id: `calendar_event_${event.google_event_id}`,
        title: event.title || 'Calendar Event',
        body: `${event.description || ''}\n\nWhen: ${startFormatted} - ${endFormatted}${event.location ? `\nWhere: ${event.location}` : ''}`,
        type: 'event',
        source: 'gcal',  // Add source for logging
        url: event.html_link,
        space_id: spaceId,
        created_at: event.created_at,
        updated_at: event.updated_at,
        created_by: event.added_by,
        tags: [],
        rank: event.similarity || 0,
        score: event.similarity || 0,
        metadata: {
          google_event_id: event.google_event_id,
          start_time: event.start_time,
          end_time: event.end_time,
          start_timezone: event.start_timezone,
          end_timezone: event.end_timezone,
          location: event.location,
          attendees: event.attendees,
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
    console.log(`[Hybrid Search] Result counts - Regular: ${regularResults.length}, GDocs: ${googleDocsSearchResults.length}, Calendar: ${calendarSearchResults.length}, Slack: ${slackSearchResults.length}`)
    
    const allResults = [...regularResults, ...googleDocsSearchResults, ...calendarSearchResults, ...slackSearchResults]
    
    // Sort by score/rank
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0))
    
    console.log(`[Hybrid Search] Top 5 results:`)
    allResults.slice(0, 5).forEach((result, i) => {
      console.log(`  ${i+1}. [${result.type}] ${result.title} (score: ${result.score?.toFixed(3)}, source: ${(result as any).source})`)
    })
    
    // Apply limit and offset
    return allResults.slice(offset, offset + limit)
    
  } catch (error) {
    console.error('Hybrid search error:', error)
    // Fallback to regular search (with user filtering)
    return searchResources(query, spaceId, filters, options, userId)
  }
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
    const { data: allResources, error: checkError } = await dbClient
      .from('resource')
      .select('id, title, body, created_by, source, type')
      .eq('space_id', spaceId)
    
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
    
    console.log(`[FTS Search] Calling RPC with query: "${query}"`)
    const { data: hits, error: rpcError } = await (dbClient as any).rpc('search_resources_fts', {
      search_query: query,
      target_space_id: spaceId,
      limit_count: limit,
      offset_count: offset
    }) as { data: any[] | null, error: any }
    console.log(`[FTS Search] RPC response:`, { hitCount: hits?.length, error: rpcError })

    if (rpcError) {
      console.error('[FTS Search] RPC error:', rpcError)
      // Fallback: simple ilike query
      const { data: resources, error } = await supabaseQuery
        .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
        .order('updated_at', { ascending: false })
        .limit(limit)
        .range(offset, offset + limit - 1)
      if (error) {
        console.error('[FTS Search] Client fallback error:', error)
        return []
      }
      console.log(`[FTS Search] Fallback found ${resources?.length || 0} resources`)
      return (resources || []).map((resource: Record<string, unknown>) => ({
        ...resource,
        tags: (resource.tags as Array<{ tag: Record<string, unknown> }>)?.map((rt) => rt.tag).filter(Boolean) || [],
        rank: 1,
        score: 1
      })) as SearchResult[]
    }

    console.log(`[FTS Search] Raw hits: ${hits?.length || 0}`)
    if (hits && hits.length > 0) {
      console.log(`[FTS Search] First hit:`, { id: hits[0].id, title: hits[0].title, created_by: hits[0].created_by })
    }

    // Filter by userId at application level (since auth.uid() doesn't work with Clerk)
    let filteredHits = hits || []
    if (userId) {
      const beforeFilter = filteredHits.length
      filteredHits = filteredHits.filter((hit: any) => hit.created_by === userId)
      console.log(`[FTS Search] Filtered by user: ${beforeFilter} -> ${filteredHits.length}`)
    }

    const ids = filteredHits.map((h: any) => h.id as string)
    console.log(`[FTS Search] Final resource IDs:`, ids)
    if (ids.length === 0) {
      console.log(`[FTS Search] No results after user filter`)
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
    parts.push(resource.tags.map(tag => tag.name).join(' '))
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
