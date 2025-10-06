import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { searchResourcesHybrid, logQuery } from '@/lib/search'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check rate limit
    const rateLimitResult = checkRateLimit(userId, 'SEARCH')
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: 'Rate limit exceeded', 
          remaining: rateLimitResult.remaining,
          resetTime: rateLimitResult.resetTime
        }, 
        { status: 429 }
      )
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q') || ''
    const spaceId = searchParams.get('spaceId') || '00000000-0000-0000-0000-000000000000'
    const type = searchParams.get('type') || undefined
    const tags = searchParams.get('tags')?.split(',').filter(Boolean) || []
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const filters = {
      type,
      tags: tags.length > 0 ? tags : undefined,
      from,
      to
    }

    const results = await searchResourcesHybrid(
      query,
      spaceId,
      filters,
      { limit, offset }
    )

    // Log the query
    await logQuery(
      spaceId,
      userId,
      query,
      results.length
    )

    return NextResponse.json({ 
      results,
      rateLimit: {
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime
      }
    })
  } catch (error) {
    logger.error('Hybrid search API error', error as Error, { userId, query })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}