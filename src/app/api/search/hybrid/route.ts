import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { searchResourcesHybrid, logQuery } from '@/lib/search'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    const { supabase } = await import('@/lib/supabase')
    
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

    // Get user's spaces to search across all of them
    let spaceIds = ['00000000-0000-0000-0000-000000000000']
    if (userId) {
      try {
        const { clerkClient } = await import('@clerk/nextjs/server')
        const clerkUser = await clerkClient().users.getUser(userId)
        const userEmail = clerkUser.emailAddresses[0]?.emailAddress

        const { data: userSpaces } = await supabase
          .from('app_user')
          .select('space_id')
          .eq('email', userEmail)

        const userSpaceIds = userSpaces?.map(u => u.space_id) || []
        spaceIds = [...new Set([...spaceIds, ...userSpaceIds])]
      } catch (error) {
        console.error('Failed to get user spaces for search:', error)
        // Fall back to default space only
      }
    }

    // Search across all user spaces
    const allResults = []
    for (const spaceId of spaceIds) {
      const results = await searchResourcesHybrid(
        query,
        spaceId,
        filters,
        { limit, offset }
      )
      allResults.push(...results)
    }

    // Remove duplicates and sort by relevance
    const uniqueResults = Array.from(
      new Map(allResults.map(r => [r.id, r])).values()
    ).slice(0, limit)

    // Log the query
    await logQuery(
      '00000000-0000-0000-0000-000000000000',
      testUserId,
      query,
      uniqueResults.length
    )

    return NextResponse.json({ results: uniqueResults })
  } catch (error) {
    console.error('Hybrid search API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}