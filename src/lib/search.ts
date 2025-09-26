import { supabase, supabaseAdmin } from './supabase'
import { ResourceWithTags, SearchResult } from './database.types'

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

export async function searchResources(
  query: string,
  spaceId: string,
  filters: SearchFilters = {},
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 20, offset = 0 } = options

  // Build the base query
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

  // For now, use a simple text search approach
  if (query.trim()) {
    // Use ilike for simple text search
    const { data: resources, error } = await supabaseQuery
      .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
      .order('updated_at', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Search error:', error)
      return []
    }

    // Transform the data to match SearchResult interface
    return (resources || []).map((resource: Record<string, unknown>) => ({
      ...resource,
      tags: (resource.tags as Array<{ tag: Record<string, unknown> }>)?.map((rt) => rt.tag).filter(Boolean) || [],
      rank: 1,
      score: 1
    })) as SearchResult[]
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
  clickedResourceId?: string
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
