// Performance monitoring and metrics collection
import { logger } from './logger'

interface MetricData {
  name: string
  value: number
  timestamp: number
  tags?: Record<string, string>
}

interface PerformanceMetrics {
  apiCalls: number
  averageResponseTime: number
  errorRate: number
  cacheHitRate: number
  embeddingGenerationTime: number
  searchQueryTime: number
}

class MetricsCollector {
  private metrics: MetricData[] = []
  private performanceData: PerformanceMetrics = {
    apiCalls: 0,
    averageResponseTime: 0,
    errorRate: 0,
    cacheHitRate: 0,
    embeddingGenerationTime: 0,
    searchQueryTime: 0
  }

  // Record a metric
  record(name: string, value: number, tags?: Record<string, string>) {
    const metric: MetricData = {
      name,
      value,
      timestamp: Date.now(),
      tags
    }
    
    this.metrics.push(metric)
    
    // Keep only last 1000 metrics to prevent memory leaks
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000)
    }
    
    logger.debug('Metric recorded', { name, value, tags })
  }

  // Record API call timing
  recordApiCall(endpoint: string, method: string, duration: number, statusCode: number) {
    this.performanceData.apiCalls++
    
    // Update average response time
    const totalTime = this.performanceData.averageResponseTime * (this.performanceData.apiCalls - 1) + duration
    this.performanceData.averageResponseTime = totalTime / this.performanceData.apiCalls
    
    this.record('api_call_duration', duration, {
      endpoint,
      method,
      status_code: statusCode.toString()
    })
    
    if (statusCode >= 400) {
      this.record('api_error', 1, {
        endpoint,
        method,
        status_code: statusCode.toString()
      })
    }
  }

  // Record search query performance
  recordSearchQuery(query: string, duration: number, resultCount: number, fromCache: boolean = false) {
    this.performanceData.searchQueryTime = duration
    
    this.record('search_query_duration', duration, {
      query_length: query.length.toString(),
      result_count: resultCount.toString(),
      from_cache: fromCache.toString()
    })
    
    if (fromCache) {
      this.record('cache_hit', 1, { type: 'search' })
    } else {
      this.record('cache_miss', 1, { type: 'search' })
    }
  }

  // Record embedding generation performance
  recordEmbeddingGeneration(textLength: number, duration: number, success: boolean) {
    this.performanceData.embeddingGenerationTime = duration
    
    this.record('embedding_generation_duration', duration, {
      text_length: textLength.toString(),
      success: success.toString()
    })
    
    if (!success) {
      this.record('embedding_error', 1, { text_length: textLength.toString() })
    }
  }

  // Record cache performance
  recordCacheOperation(operation: 'hit' | 'miss' | 'set', key: string, ttl?: number) {
    if (operation === 'hit') {
      this.record('cache_hit', 1, { key: key.substring(0, 50) })
    } else if (operation === 'miss') {
      this.record('cache_miss', 1, { key: key.substring(0, 50) })
    } else if (operation === 'set') {
      this.record('cache_set', 1, { 
        key: key.substring(0, 50),
        ttl: ttl?.toString() || 'unknown'
      })
    }
  }

  // Get current performance metrics
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceData }
  }

  // Get metrics for a specific time range
  getMetrics(name: string, since?: number): MetricData[] {
    const cutoff = since || (Date.now() - 24 * 60 * 60 * 1000) // Default to last 24 hours
    return this.metrics.filter(m => m.name === name && m.timestamp >= cutoff)
  }

  // Get aggregated metrics
  getAggregatedMetrics(name: string, since?: number): {
    count: number
    average: number
    min: number
    max: number
    sum: number
  } {
    const metrics = this.getMetrics(name, since)
    
    if (metrics.length === 0) {
      return { count: 0, average: 0, min: 0, max: 0, sum: 0 }
    }
    
    const values = metrics.map(m => m.value)
    const sum = values.reduce((a, b) => a + b, 0)
    
    return {
      count: metrics.length,
      average: sum / metrics.length,
      min: Math.min(...values),
      max: Math.max(...values),
      sum
    }
  }

  // Clear old metrics
  clearOldMetrics(olderThanMs: number = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - olderThanMs
    this.metrics = this.metrics.filter(m => m.timestamp >= cutoff)
  }

  // Get health status
  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy'
    metrics: PerformanceMetrics
    issues: string[]
  } {
    const issues: string[] = []
    
    // Check error rate
    const errorMetrics = this.getAggregatedMetrics('api_error')
    const totalApiCalls = this.performanceData.apiCalls
    const errorRate = totalApiCalls > 0 ? (errorMetrics.sum / totalApiCalls) * 100 : 0
    
    if (errorRate > 10) {
      issues.push(`High error rate: ${errorRate.toFixed(2)}%`)
    }
    
    // Check average response time
    if (this.performanceData.averageResponseTime > 5000) {
      issues.push(`Slow response time: ${this.performanceData.averageResponseTime.toFixed(2)}ms`)
    }
    
    // Check embedding generation time
    if (this.performanceData.embeddingGenerationTime > 10000) {
      issues.push(`Slow embedding generation: ${this.performanceData.embeddingGenerationTime.toFixed(2)}ms`)
    }
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
    if (issues.length > 0) {
      status = issues.length > 2 ? 'unhealthy' : 'degraded'
    }
    
    return {
      status,
      metrics: this.performanceData,
      issues
    }
  }
}

// Global metrics collector instance
export const metrics = new MetricsCollector()

// Performance monitoring decorator
export function monitorPerformance(name: string, tags?: Record<string, string>) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const start = Date.now()
      try {
        const result = await method.apply(this, args)
        const duration = Date.now() - start
        metrics.record(`${name}_duration`, duration, tags)
        return result
      } catch (error) {
        const duration = Date.now() - start
        metrics.record(`${name}_error`, 1, { ...tags, error: (error as Error).message })
        metrics.record(`${name}_duration`, duration, { ...tags, error: 'true' })
        throw error
      }
    }
  }
}

// Cleanup old metrics every hour
if (typeof process !== 'undefined') {
  setInterval(() => {
    metrics.clearOldMetrics()
  }, 60 * 60 * 1000)
}