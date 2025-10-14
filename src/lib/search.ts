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
    
    // Search Google Docs chunks using admin client (user filtering by userId parameter)
    // Note: We filter by userId manually after fetching results
    const { data: googleDocsResults, error: gdError } = await searchClient
      .rpc('search_google_docs_vector', {
        query_embedding: queryEmbedding,
        target_space_id: spaceId,
        limit_count: limit * 2,
        offset_count: 0
      })

    if (gdError) {
      console.error('Google Docs search error:', gdError)
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

    // Filter Google Docs by userId (since we bypassed RLS with admin client)
    const userFilteredGoogleDocs = userId 
      ? (googleDocsResults || []).filter((chunk: any) => chunk.added_by === userId)
      : (googleDocsResults || [])

    // Convert Google Docs results to SearchResult format
    const googleDocsSearchResults: SearchResult[] = userFilteredGoogleDocs.map((chunk: any) => ({
      id: `google_doc_${chunk.source_id}_${chunk.id}`,
      title: `Google Doc Chunk`,
      body: chunk.text,
      type: 'google_doc',
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
    }))

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
      }
    })

    // Convert Slack results to SearchResult format
    const slackSearchResults: SearchResult[] = (slackResults || []).map((msg: any) => ({
      id: `slack_message_${msg.slack_message_id}`,
      title: msg.channel_context || 'Slack Message',
      body: msg.text,
      type: 'slack',
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
    }))

    // Combine and rank results from all sources
    const allResults = [...regularResults, ...googleDocsSearchResults, ...calendarSearchResults, ...slackSearchResults]
    
    // Sort by score/rank
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0))
    
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

  // Build the base query (used only for non-search listing)
  let supabaseQuery = supabase
    .from('resource')
    .select(`
      *,
      tags:resource_tag(
        tag:tag(*)
      ),
      event_meta(*),
      created_by_user:app_user(*)
    `)
    .eq('space_id', spaceId)
  
  // Filter by user if provided (RLS will also enforce this)
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
    // Use Postgres full-text search function for ranked results (client-side)
    const { data: hits, error: rpcError } = await (supabase as any).rpc('search_resources', {
      search_query: query,
      target_space_id: spaceId,
      limit_count: limit,
      offset_count: offset
    }) as { data: any[] | null, error: any }

    if (rpcError) {
      console.error('FTS RPC error:', rpcError)
      // Fallback: simple ilike query
      const { data: resources, error } = await supabaseQuery
        .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
        .order('updated_at', { ascending: false })
        .limit(limit)
        .range(offset, offset + limit - 1)
      if (error) {
        console.error('Client fallback search error:', error)
        return []
      }
      return (resources || []).map((resource: Record<string, unknown>) => ({
        ...resource,
        tags: (resource.tags as Array<{ tag: Record<string, unknown> }>)?.map((rt) => rt.tag).filter(Boolean) || [],
        rank: 1,
        score: 1
      })) as SearchResult[]
    }

    const ids = (hits || []).map((h: any) => h.id as string)
    if (ids.length === 0) return []

    // Fetch relationship-expanded records
    const { data: resources, error } = await supabase
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*),
        created_by_user:app_user(*)
      `)
      .in('id', ids)

    if (error) {
      console.error('Search expand error:', error)
      return []
    }

    const idToRank: Record<string, { rank: number; score: number; order: number }> = {}
    ids.forEach((id: string, idx: number) => {
      const hit = (hits as any[]).find((h) => h.id === id)
      idToRank[id] = { rank: (hit?.rank as number) || 0, score: (hit?.score as number) || 0, order: idx }
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
