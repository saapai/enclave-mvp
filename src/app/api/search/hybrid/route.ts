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
    const spaceIdsParam = searchParams.get('spaceIds')

    const filters = {
      type,
      tags: tags.length > 0 ? tags : undefined,
      from,
      to
    }

    // Get workspace IDs to search - either from query param or user's workspaces
    let spaceIds: string[] = []
    
    if (spaceIdsParam) {
      // Use workspace IDs from query parameter (selected by user)
      spaceIds = spaceIdsParam.split(',').filter(Boolean)
      console.log('[Hybrid Search API] Using workspace IDs from query param:', spaceIds)
    } else if (userId) {
      // Fall back to all user's workspaces
      try {
        const { clerkClient } = await import('@clerk/nextjs/server')
        const client = await clerkClient()
        const clerkUser = await client.users.getUser(userId)
        const userEmail = clerkUser.emailAddresses[0]?.emailAddress

        const { data: userSpaces } = await supabase
          .from('app_user')
          .select('space_id')
          .eq('email', userEmail)

        const userSpaceIds = userSpaces?.map(u => u.space_id) || []
        spaceIds = [...new Set(['00000000-0000-0000-0000-000000000000', ...userSpaceIds])]
        console.log('[Hybrid Search API] Using user workspaces:', spaceIds)
      } catch (error) {
        console.error('Failed to get user spaces for search:', error)
        spaceIds = ['00000000-0000-0000-0000-000000000000']
      }
    } else {
      spaceIds = ['00000000-0000-0000-0000-000000000000']
    }
    
    // CRITICAL: Verify user has access to these workspaces
    if (userId) {
      try {
        const { clerkClient } = await import('@clerk/nextjs/server')
        const client = await clerkClient()
        const clerkUser = await client.users.getUser(userId)
        const userEmail = clerkUser.emailAddresses[0]?.emailAddress

        const { data: userSpaces } = await supabase
          .from('app_user')
          .select('space_id')
          .eq('email', userEmail)

        const allowedSpaceIds = userSpaces?.map(u => u.space_id) || []
        allowedSpaceIds.push('00000000-0000-0000-0000-000000000000') // Always allow default space
        
        // Filter to only workspaces user has access to
        const originalCount = spaceIds.length
        spaceIds = spaceIds.filter(id => allowedSpaceIds.includes(id))
        console.log(`[Hybrid Search API] Security check: ${originalCount} -> ${spaceIds.length} workspaces allowed`)
        console.log('[Hybrid Search API] Allowed workspaces:', spaceIds)
        
        // If no workspaces allowed, return empty results
        if (spaceIds.length === 0) {
          console.log('[Hybrid Search API] No workspaces allowed for user, returning empty results')
          return NextResponse.json({ results: [] })
        }
      } catch (error) {
        console.error('Failed to verify workspace access:', error)
        // If verification fails, return empty results for security
        return NextResponse.json({ results: [] })
      }
    } else {
      // No userId, only allow default space
      spaceIds = ['00000000-0000-0000-0000-000000000000']
    }

    // Search across all user spaces
    const allResults = []
    for (const spaceId of spaceIds) {
      const results = await searchResourcesHybrid(
        query,
        spaceId,
        filters,
        { limit, offset },
        userId  // CRITICAL: Pass userId for proper filtering
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