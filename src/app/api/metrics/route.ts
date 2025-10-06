import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { metrics } from '@/lib/metrics'
import { queryMonitor } from '@/lib/query-monitor'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only allow admin users to view metrics
    // For now, we'll allow all authenticated users, but in production you'd check roles
    const url = new URL(request.url)
    const includeDetails = url.searchParams.get('details') === 'true'
    const timeRange = url.searchParams.get('timeRange') || '24h'
    
    const timeRangeMs = timeRange === '1h' ? 60 * 60 * 1000 :
                       timeRange === '24h' ? 24 * 60 * 60 * 1000 :
                       timeRange === '7d' ? 7 * 24 * 60 * 60 * 1000 :
                       24 * 60 * 60 * 1000

    const performanceMetrics = metrics.getPerformanceMetrics()
    const healthStatus = metrics.getHealthStatus()
    
    const response = {
      timestamp: new Date().toISOString(),
      timeRange,
      performance: {
        apiCalls: performanceMetrics.apiCalls,
        averageResponseTime: Math.round(performanceMetrics.averageResponseTime),
        searchQueryTime: Math.round(performanceMetrics.searchQueryTime),
        embeddingGenerationTime: Math.round(performanceMetrics.embeddingGenerationTime)
      },
      health: healthStatus,
      ...(includeDetails && {
        detailed: {
          apiCallMetrics: metrics.getAggregatedMetrics('api_call_duration', timeRangeMs),
          searchMetrics: metrics.getAggregatedMetrics('search_query_duration', timeRangeMs),
          embeddingMetrics: metrics.getAggregatedMetrics('embedding_generation_duration', timeRangeMs),
          cacheMetrics: {
            hits: metrics.getAggregatedMetrics('cache_hit', timeRangeMs),
            misses: metrics.getAggregatedMetrics('cache_miss', timeRangeMs)
          },
          errorMetrics: metrics.getAggregatedMetrics('api_error', timeRangeMs),
          queryStats: {
            all: queryMonitor.getQueryStats(),
            search: queryMonitor.getQueryStats('search_google_docs_vector'),
            regular: queryMonitor.getQueryStats('search_resources')
          },
          slowQueries: queryMonitor.getSlowQueries(10),
          recentErrors: queryMonitor.getRecentErrors(10)
        }
      })
    }

    logger.debug('Metrics requested', { userId, timeRange, includeDetails })

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })

  } catch (error) {
    logger.error('Metrics API error', error as Error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}