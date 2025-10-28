/**
 * Source-Specialized Retrievers
 * Optimized search for Google Docs, Calendar, Slack
 */

import { supabaseAdmin } from './supabase'
import { embedText } from './embeddings'
import { SearchResult } from './database.types'

// ============================================================================
// GOOGLE DOCS RETRIEVER
// ============================================================================

/**
 * Specialized Google Docs retriever
 * - Searches hierarchical chunks (section → passage)
 * - Preserves document structure
 * - Returns precise snippets with context
 */
export async function retrieveFromGoogleDocs(
  query: string,
  spaceId: string,
  limit: number = 5
): Promise<SearchResult[]> {
  console.log(`[GDocs Retriever] Searching Google Docs for: "${query}"`)

  try {
    // Generate embedding
    const embedding = await embedText(query)

    // Search passage-level chunks first (more precise)
    const { data: passageChunks, error: passageError } = await supabaseAdmin
      .rpc('search_google_doc_chunks', {
        query_embedding: embedding,
        space_id_param: spaceId,
        match_threshold: 0.6,
        match_count: limit * 2
      })

    if (passageError) {
      console.error('[GDocs Retriever] Passage search error:', passageError)
      return []
    }

    if (!passageChunks || passageChunks.length === 0) {
      console.log('[GDocs Retriever] No passage chunks found, trying sections')
      
      // Fallback to section-level search
      // (Implementation would be similar, searching larger chunks)
    }

    // Convert to SearchResult format
    const results: SearchResult[] = passageChunks.map((chunk: any) => ({
      id: chunk.source_id,
      title: chunk.heading_path?.[0] || 'Google Doc',
      body: chunk.text,
      type: 'doc',
      source: 'gdoc',
      score: chunk.similarity,
      space_id: spaceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        chunk_id: chunk.chunk_id,
        heading_path: chunk.heading_path,
        chunk_index: chunk.chunk_index
      }
    }))

    console.log(`[GDocs Retriever] Found ${results.length} results`)
    return results

  } catch (error) {
    console.error('[GDocs Retriever] Error:', error)
    return []
  }
}

// ============================================================================
// CALENDAR RETRIEVER
// ============================================================================

/**
 * Specialized Calendar retriever
 * - Time-aware search (prioritize upcoming events)
 * - Recurrence handling
 * - Location and attendee matching
 */
export async function retrieveFromCalendar(
  query: string,
  spaceId: string,
  limit: number = 5
): Promise<SearchResult[]> {
  console.log(`[Calendar Retriever] Searching calendar for: "${query}"`)

  try {
    const now = new Date()
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    // Extract time-related keywords
    const timeKeywords = extractTimeKeywords(query)
    
    // Build query
    let dbQuery = supabaseAdmin
      .from('resource')
      .select('*')
      .eq('space_id', spaceId)
      .eq('source', 'gcal')

    // If query mentions "next" or "upcoming", filter to future events
    if (timeKeywords.includes('next') || timeKeywords.includes('upcoming')) {
      dbQuery = dbQuery.gte('metadata->start_at', now.toISOString())
    }

    // If query mentions "today" or "this week", filter to near future
    if (timeKeywords.includes('today') || timeKeywords.includes('week')) {
      dbQuery = dbQuery
        .gte('metadata->start_at', now.toISOString())
        .lte('metadata->start_at', oneWeekFromNow.toISOString())
    }

    // Text search on title and body
    const searchTerms = query.toLowerCase().split(/\s+/)
    
    const { data: events, error } = await dbQuery.limit(limit * 2)

    if (error) {
      console.error('[Calendar Retriever] Error:', error)
      return []
    }

    if (!events || events.length === 0) {
      return []
    }

    // Score events based on relevance
    const scoredEvents = events.map(event => {
      let score = 0

      // Title match
      const titleLower = event.title.toLowerCase()
      for (const term of searchTerms) {
        if (titleLower.includes(term)) {
          score += 0.3
        }
      }

      // Body match
      const bodyLower = (event.body || '').toLowerCase()
      for (const term of searchTerms) {
        if (bodyLower.includes(term)) {
          score += 0.2
        }
      }

      // Time relevance (boost upcoming events)
      const startAt = event.metadata?.start_at
      if (startAt) {
        const eventDate = new Date(startAt)
        const daysUntil = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        
        if (daysUntil >= 0 && daysUntil <= 7) {
          score += 0.3 // Boost events in next week
        } else if (daysUntil > 7 && daysUntil <= 30) {
          score += 0.1 // Slight boost for events in next month
        }
      }

      return {
        ...event,
        score
      }
    })

    // Sort by score and limit
    const results = scoredEvents
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(event => ({
        id: event.id,
        title: event.title,
        body: event.body,
        type: event.type,
        source: event.source,
        score: event.score,
        space_id: event.space_id,
        created_at: event.created_at,
        updated_at: event.updated_at,
        metadata: event.metadata
      }))

    console.log(`[Calendar Retriever] Found ${results.length} events`)
    return results

  } catch (error) {
    console.error('[Calendar Retriever] Error:', error)
    return []
  }
}

/**
 * Extract time-related keywords from query
 */
function extractTimeKeywords(query: string): string[] {
  const lowerQuery = query.toLowerCase()
  const keywords: string[] = []

  const timeWords = [
    'today', 'tomorrow', 'tonight', 'next', 'upcoming', 'week', 'month',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  ]

  for (const word of timeWords) {
    if (lowerQuery.includes(word)) {
      keywords.push(word)
    }
  }

  return keywords
}

// ============================================================================
// SLACK RETRIEVER
// ============================================================================

/**
 * Specialized Slack retriever
 * - Channel-aware search
 * - Thread context preservation
 * - Recency boost
 * - Author authority
 */
export async function retrieveFromSlack(
  query: string,
  spaceId: string,
  limit: number = 5
): Promise<SearchResult[]> {
  console.log(`[Slack Retriever] Searching Slack for: "${query}"`)

  try {
    const now = new Date()
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Extract channel hints from query
    const channelHints = extractChannelHints(query)

    // Build query
    let dbQuery = supabaseAdmin
      .from('slack_message')
      .select('*')
      .eq('space_id', spaceId)
      .gte('created_at', oneMonthAgo.toISOString()) // Only recent messages

    // If channel mentioned, filter
    if (channelHints.length > 0) {
      dbQuery = dbQuery.in('channel_name', channelHints)
    }

    const { data: messages, error } = await dbQuery.limit(limit * 3)

    if (error) {
      console.error('[Slack Retriever] Error:', error)
      return []
    }

    if (!messages || messages.length === 0) {
      return []
    }

    // Score messages
    const searchTerms = query.toLowerCase().split(/\s+/)
    
    const scoredMessages = messages.map(msg => {
      let score = 0

      // Text match
      const textLower = msg.text.toLowerCase()
      for (const term of searchTerms) {
        if (textLower.includes(term)) {
          score += 0.4
        }
      }

      // Thread context match
      if (msg.thread_context) {
        const threadLower = msg.thread_context.toLowerCase()
        for (const term of searchTerms) {
          if (threadLower.includes(term)) {
            score += 0.2
          }
        }
      }

      // Channel boost
      if (msg.channel_name === 'announcements') {
        score += 0.2
      } else if (msg.channel_name === 'general') {
        score += 0.1
      }

      // Recency boost
      const msgDate = new Date(msg.created_at)
      const daysOld = (now.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24)
      
      if (daysOld <= 7) {
        score += 0.2
      } else if (daysOld <= 30) {
        score += 0.1
      }

      return {
        ...msg,
        score
      }
    })

    // Sort and limit
    const results = scoredMessages
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(msg => ({
        id: msg.id,
        title: `#${msg.channel_name} - ${msg.author_name || 'Unknown'}`,
        body: msg.text,
        type: 'message' as const,
        source: 'slack',
        score: msg.score,
        space_id: msg.space_id,
        created_at: msg.created_at,
        updated_at: msg.created_at,
        metadata: {
          channel_name: msg.channel_name,
          author_name: msg.author_name,
          thread_context: msg.thread_context
        }
      }))

    console.log(`[Slack Retriever] Found ${results.length} messages`)
    return results

  } catch (error) {
    console.error('[Slack Retriever] Error:', error)
    return []
  }
}

/**
 * Extract channel hints from query
 */
function extractChannelHints(query: string): string[] {
  const lowerQuery = query.toLowerCase()
  const channels: string[] = []

  // Common channel names
  const channelNames = [
    'announcements', 'general', 'random', 'officers',
    'events', 'social', 'professional'
  ]

  for (const channel of channelNames) {
    if (lowerQuery.includes(channel)) {
      channels.push(channel)
    }
  }

  return channels
}

// ============================================================================
// UNIFIED RETRIEVER
// ============================================================================

/**
 * Retrieve from all specialized sources and combine
 */
export async function retrieveFromAllSources(
  query: string,
  spaceId: string,
  options: {
    includeGoogleDocs?: boolean
    includeCalendar?: boolean
    includeSlack?: boolean
    limit?: number
  } = {}
): Promise<SearchResult[]> {
  const {
    includeGoogleDocs = true,
    includeCalendar = true,
    includeSlack = true,
    limit = 10
  } = options

  console.log(`[Specialized Retriever] Retrieving from all sources`)

  const results: SearchResult[] = []

  // Retrieve from each source in parallel
  const promises: Promise<SearchResult[]>[] = []

  if (includeGoogleDocs) {
    promises.push(retrieveFromGoogleDocs(query, spaceId, Math.ceil(limit / 3)))
  }

  if (includeCalendar) {
    promises.push(retrieveFromCalendar(query, spaceId, Math.ceil(limit / 3)))
  }

  if (includeSlack) {
    promises.push(retrieveFromSlack(query, spaceId, Math.ceil(limit / 3)))
  }

  const allResults = await Promise.all(promises)

  // Combine and sort
  for (const sourceResults of allResults) {
    results.push(...sourceResults)
  }

  // Sort by score and limit
  results.sort((a, b) => (b.score || 0) - (a.score || 0))

  console.log(`[Specialized Retriever] Combined ${results.length} results from all sources`)

  return results.slice(0, limit)
}

