/**
 * Telemetry and Logging
 * Track query performance and quality metrics
 */

import { supabaseAdmin } from './supabase'
import { QueryPlan, ToolResult } from './planner'
import { SearchResult } from './database.types'

// ============================================================================
// TYPES
// ============================================================================

export interface QueryTelemetry {
  query: string
  space_id: string
  user_id?: string
  
  // Plan info
  intent?: string
  plan_confidence?: number
  tools_used?: string[]
  
  // Results
  result_count: number
  top_result_id?: string
  top_result_score?: number
  
  // Performance
  retrieval_time_ms: number
  total_time_ms: number
  
  // Source breakdown
  sources_used?: Record<string, number>
  
  // Response quality
  response_confidence?: number
  response_length?: number
  
  // Metadata
  metadata?: Record<string, any>
}

// ============================================================================
// TELEMETRY LOGGING
// ============================================================================

/**
 * Log query telemetry
 */
export async function logQueryTelemetry(telemetry: QueryTelemetry): Promise<void> {
  try {
    await supabaseAdmin
      .from('query_telemetry')
      .insert(telemetry)

    console.log(`[Telemetry] Logged query: "${telemetry.query}" (${telemetry.retrieval_time_ms}ms)`)
  } catch (error) {
    console.error('[Telemetry] Error logging:', error)
  }
}

/**
 * Log planner-based query
 */
export async function logPlannerQuery(
  query: string,
  spaceId: string,
  plan: QueryPlan,
  toolResults: ToolResult[],
  results: SearchResult[],
  timings: { retrieval: number; total: number },
  userId?: string
): Promise<void> {
  const telemetry: QueryTelemetry = {
    query,
    space_id: spaceId,
    user_id: userId,
    
    intent: plan.intent,
    plan_confidence: plan.confidence,
    tools_used: toolResults.map(t => t.tool),
    
    result_count: results.length,
    top_result_id: results[0]?.id,
    top_result_score: results[0]?.score,
    
    retrieval_time_ms: timings.retrieval,
    total_time_ms: timings.total,
    
    sources_used: countSources(results),
    
    response_confidence: toolResults[0]?.confidence,
    
    metadata: {
      plan_reasoning: plan.reasoning,
      tool_results: toolResults.map(t => ({ tool: t.tool, success: t.success }))
    }
  }

  await logQueryTelemetry(telemetry)
}

/**
 * Log traditional search query
 */
export async function logSearchQuery(
  query: string,
  spaceId: string,
  results: SearchResult[],
  timings: { retrieval: number; total: number },
  userId?: string
): Promise<void> {
  const telemetry: QueryTelemetry = {
    query,
    space_id: spaceId,
    user_id: userId,
    
    result_count: results.length,
    top_result_id: results[0]?.id,
    top_result_score: results[0]?.score,
    
    retrieval_time_ms: timings.retrieval,
    total_time_ms: timings.total,
    
    sources_used: countSources(results)
  }

  await logQueryTelemetry(telemetry)
}

/**
 * Count results by source type
 */
function countSources(results: SearchResult[]): Record<string, number> {
  const counts: Record<string, number> = {}
  
  for (const result of results) {
    const source = (result as any).source || 'unknown'
    counts[source] = (counts[source] || 0) + 1
  }
  
  return counts
}

// ============================================================================
// USER FEEDBACK
// ============================================================================

/**
 * Record user feedback on a query
 */
export async function recordUserFeedback(
  telemetryId: string,
  satisfaction: 'thumbs_up' | 'thumbs_down',
  feedback?: string
): Promise<void> {
  try {
    await supabaseAdmin
      .from('query_telemetry')
      .update({
        user_satisfaction: satisfaction,
        user_feedback: feedback
      })
      .eq('id', telemetryId)

    console.log(`[Telemetry] Recorded feedback: ${satisfaction}`)
  } catch (error) {
    console.error('[Telemetry] Error recording feedback:', error)
  }
}

// ============================================================================
// ANALYTICS
// ============================================================================

/**
 * Get telemetry summary for a time period
 */
export async function getTelemetrySummary(
  spaceId: string,
  startDate: Date,
  endDate: Date
): Promise<any> {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('get_telemetry_summary', {
        space_id_param: spaceId,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString()
      })

    if (error) throw error

    return data
  } catch (error) {
    console.error('[Telemetry] Error getting summary:', error)
    return null
  }
}

/**
 * Get slow queries (for optimization)
 */
export async function getSlowQueries(
  spaceId: string,
  thresholdMs: number = 2000,
  limit: number = 20
): Promise<any[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('query_telemetry')
      .select('*')
      .eq('space_id', spaceId)
      .gte('retrieval_time_ms', thresholdMs)
      .order('retrieval_time_ms', { ascending: false })
      .limit(limit)

    if (error) throw error

    return data || []
  } catch (error) {
    console.error('[Telemetry] Error getting slow queries:', error)
    return []
  }
}

/**
 * Get queries with low confidence (for improvement)
 */
export async function getLowConfidenceQueries(
  spaceId: string,
  thresholdConfidence: number = 0.5,
  limit: number = 20
): Promise<any[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('query_telemetry')
      .select('*')
      .eq('space_id', spaceId)
      .lte('response_confidence', thresholdConfidence)
      .order('response_confidence', { ascending: true })
      .limit(limit)

    if (error) throw error

    return data || []
  } catch (error) {
    console.error('[Telemetry] Error getting low confidence queries:', error)
    return []
  }
}

