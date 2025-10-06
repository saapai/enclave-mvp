// Database query monitoring and optimization
import { logger } from './logger'
import { metrics } from './metrics'

interface QueryMetrics {
  query: string
  duration: number
  rowsAffected?: number
  error?: string
  timestamp: number
}

class QueryMonitor {
  private queries: QueryMetrics[] = []
  private slowQueryThreshold = 1000 // 1 second
  private maxQueries = 1000

  // Monitor a database query
  async monitorQuery<T>(
    queryName: string,
    queryFn: () => Promise<T>,
    expectedRows?: number
  ): Promise<T> {
    const startTime = Date.now()
    
    try {
      const result = await queryFn()
      const duration = Date.now() - startTime
      
      // Record successful query
      this.recordQuery({
        query: queryName,
        duration,
        rowsAffected: Array.isArray(result) ? result.length : expectedRows,
        timestamp: Date.now()
      })
      
      // Check for slow queries
      if (duration > this.slowQueryThreshold) {
        logger.warn('Slow query detected', {
          query: queryName,
          duration,
          threshold: this.slowQueryThreshold
        })
      }
      
      // Record metrics
      metrics.record('db_query_duration', duration, { query: queryName })
      
      return result
    } catch (error) {
      const duration = Date.now() - startTime
      
      // Record failed query
      this.recordQuery({
        query: queryName,
        duration,
        error: (error as Error).message,
        timestamp: Date.now()
      })
      
      logger.error('Database query failed', error as Error, { query: queryName, duration })
      
      // Record error metrics
      metrics.record('db_query_error', 1, { query: queryName })
      
      throw error
    }
  }

  private recordQuery(query: QueryMetrics) {
    this.queries.push(query)
    
    // Keep only recent queries
    if (this.queries.length > this.maxQueries) {
      this.queries = this.queries.slice(-this.maxQueries)
    }
  }

  // Get query performance statistics
  getQueryStats(queryName?: string) {
    const relevantQueries = queryName 
      ? this.queries.filter(q => q.query === queryName)
      : this.queries
    
    if (relevantQueries.length === 0) {
      return {
        count: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        errorRate: 0,
        slowQueries: 0
      }
    }
    
    const durations = relevantQueries.map(q => q.duration)
    const errors = relevantQueries.filter(q => q.error)
    const slowQueries = relevantQueries.filter(q => q.duration > this.slowQueryThreshold)
    
    return {
      count: relevantQueries.length,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      errorRate: (errors.length / relevantQueries.length) * 100,
      slowQueries: slowQueries.length
    }
  }

  // Get slow queries
  getSlowQueries(limit: number = 10) {
    return this.queries
      .filter(q => q.duration > this.slowQueryThreshold)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit)
  }

  // Get recent errors
  getRecentErrors(limit: number = 10) {
    return this.queries
      .filter(q => q.error)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  // Clear old queries
  clearOldQueries(olderThanMs: number = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - olderThanMs
    this.queries = this.queries.filter(q => q.timestamp >= cutoff)
  }
}

// Global query monitor instance
export const queryMonitor = new QueryMonitor()

// Helper function to wrap Supabase queries
export function monitorSupabaseQuery<T>(
  queryName: string,
  queryFn: () => Promise<{ data: T | null; error: any }>,
  expectedRows?: number
): Promise<{ data: T | null; error: any }> {
  return queryMonitor.monitorQuery(
    queryName,
    async () => {
      const result = await queryFn()
      if (result.error) {
        throw new Error(`Supabase query error: ${result.error.message}`)
      }
      return result
    },
    expectedRows
  )
}

// Cleanup old queries every hour
if (typeof process !== 'undefined') {
  setInterval(() => {
    queryMonitor.clearOldQueries()
  }, 60 * 60 * 1000)
}