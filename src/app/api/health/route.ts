import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { metrics } from '@/lib/metrics'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const startTime = Date.now()
    
    // Check database connectivity
    const { data: dbTest, error: dbError } = await supabase
      .from('space')
      .select('id')
      .limit(1)
    
    const dbHealthy = !dbError && dbTest
    
    // Check environment variables
    const envHealthy = !!(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.MISTRAL_API_KEY
    )
    
    // Get performance metrics
    const performanceMetrics = metrics.getPerformanceMetrics()
    const healthStatus = metrics.getHealthStatus()
    
    const responseTime = Date.now() - startTime
    
    // Record this health check
    metrics.record('health_check_duration', responseTime, {
      db_healthy: dbHealthy.toString(),
      env_healthy: envHealthy.toString()
    })
    
    const overallStatus = dbHealthy && envHealthy && healthStatus.status !== 'unhealthy' 
      ? 'healthy' 
      : 'unhealthy'
    
    const healthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime,
      checks: {
        database: {
          status: dbHealthy ? 'healthy' : 'unhealthy',
          error: dbError?.message
        },
        environment: {
          status: envHealthy ? 'healthy' : 'unhealthy',
          missing: [
            !process.env.NEXT_PUBLIC_SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
            !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
            !process.env.MISTRAL_API_KEY && 'MISTRAL_API_KEY'
          ].filter(Boolean)
        },
        performance: healthStatus
      },
      metrics: {
        apiCalls: performanceMetrics.apiCalls,
        averageResponseTime: Math.round(performanceMetrics.averageResponseTime),
        searchQueryTime: Math.round(performanceMetrics.searchQueryTime),
        embeddingGenerationTime: Math.round(performanceMetrics.embeddingGenerationTime)
      }
    }
    
    logger.info('Health check completed', {
      status: overallStatus,
      responseTime,
      dbHealthy,
      envHealthy
    })
    
    return NextResponse.json(healthData, {
      status: overallStatus === 'healthy' ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
    
  } catch (error) {
    logger.error('Health check failed', error as Error)
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    }, { status: 503 })
  }
}