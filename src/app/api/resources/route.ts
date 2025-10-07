import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { apiCache, CACHE_KEYS } from '@/lib/cache'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    const isDev = process.env.NODE_ENV !== 'production'
    if (!userId && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check cache first
    const cacheKey = `${CACHE_KEYS.RESOURCES}_${userId}`
    const cached = apiCache.get(cacheKey)
    if (cached) {
      return NextResponse.json({ resources: cached })
    }

    // Get user's email to find their spaces
    let spaceIds = [DEFAULT_SPACE_ID]
    try {
      const { clerkClient } = await import('@clerk/nextjs/server')
      const clerkUser = await clerkClient().users.getUser(userId!)
      const userEmail = clerkUser.emailAddresses[0]?.emailAddress

      // Get all spaces the user belongs to
      const { data: userSpaces } = await supabase
        .from('app_user')
        .select('space_id')
        .eq('email', userEmail)

      const userSpaceIds = userSpaces?.map(u => u.space_id) || []
      spaceIds = [...new Set([...spaceIds, ...userSpaceIds])]
    } catch (error) {
      console.error('Failed to get user spaces for resources:', error)
      // Fall back to default space only
    }

    // Fetch resources from all user's spaces
    const { data: resources, error } = await supabase
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*),
        created_by_user:app_user(*)
      `)
      .in('space_id', spaceIds)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('Resources fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 })
    }

    const transformed = (resources || []).map((r: any) => ({
      ...r,
      tags: (r?.tags || []).map((rt: any) => rt.tag).filter(Boolean) || []
    }))

    // Cache the result for 2 minutes (per user)
    apiCache.set(cacheKey, transformed, 2 * 60 * 1000)

    return NextResponse.json({ resources: transformed })
  } catch (error) {
    console.error('Resources API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}