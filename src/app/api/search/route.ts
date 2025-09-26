import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { searchResources, logQuery } from '@/lib/search'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    // For testing, allow requests without authentication
    const testUserId = userId || '00000000-0000-0000-0000-000000000000'

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q') || ''
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

    const results = await searchResources(
      query,
      '00000000-0000-0000-0000-000000000000', // Default space for MVP
      filters,
      { limit, offset }
    )

    // Log the query
    await logQuery(
      '00000000-0000-0000-0000-000000000000',
      testUserId,
      query,
      results.length
    )

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Search API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
