import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase, supabaseAdmin } from '@/lib/supabase'
import { apiCache, CACHE_KEYS } from '@/lib/cache'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    const isDev = process.env.NODE_ENV !== 'production'
    if (!userId && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check cache first (disabled temporarily for debugging)
    const cacheKey = `${CACHE_KEYS.RESOURCES}_${userId}`
    // const cached = apiCache.get(cacheKey)
    // if (cached) {
    //   return NextResponse.json({ resources: cached })
    // }

    // Get user's email to find their spaces
    let spaceIds = [DEFAULT_SPACE_ID]
    try {
      const { clerkClient } = await import('@clerk/nextjs/server')
      const client = await clerkClient()
      const clerkUser = await client.users.getUser(userId!)
      const userEmail = clerkUser.emailAddresses[0]?.emailAddress

      const dbClient = supabaseAdmin || supabase

      // Get all spaces the user belongs to
      const { data: userSpaces } = await dbClient
        .from('app_user')
        .select('space_id')
        .eq('email', userEmail)

      const userSpaceIds = userSpaces?.map(u => u.space_id) || []
      spaceIds = [...new Set([...spaceIds, ...userSpaceIds])]

      // Fallback: if user has no explicit workspace memberships, surface SEP spaces
      const hasNonDefaultSpace = spaceIds.some(id => id && id !== DEFAULT_SPACE_ID)
      if (!hasNonDefaultSpace) {
        const { data: sepSpaces, error: sepError } = await dbClient
          .from('space')
          .select('id')
          .ilike('name', '%SEP%')
          .limit(10)

        if (!sepError && sepSpaces && sepSpaces.length > 0) {
          const sepIds = sepSpaces.map(space => space.id).filter(Boolean)
          spaceIds = [...new Set([...spaceIds, ...sepIds])]
        }
      }
    } catch (error) {
      console.error('Failed to get user spaces for resources:', error)
      // Fall back to default space only
    }

    // Fetch resources from all user's spaces
    // Use admin client to bypass RLS (auth is validated at route level with Clerk)
    const dbClient = supabaseAdmin || supabase
    
    // Build the query
    let query = dbClient
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*)
      `)
      .in('space_id', spaceIds)
    
    // For default workspace (personal), filter by user to ensure privacy
    // For custom workspaces, allow seeing all resources in that workspace
    if (spaceIds.includes(DEFAULT_SPACE_ID)) {
      // If default space is included, we need to filter resources in default space by user
      // and allow all resources in other spaces
      const otherSpaceIds = spaceIds.filter(id => id !== DEFAULT_SPACE_ID)
      
      if (otherSpaceIds.length > 0) {
        // User has both default space and other spaces
        query = query.or(`and(space_id.eq.${DEFAULT_SPACE_ID},created_by.eq.${userId}),space_id.in.(${otherSpaceIds.join(',')})`)
      } else {
        // User only has default space
        query = query.eq('created_by', userId)
      }
    }
    
    const { data: resources, error } = await query.order('updated_at', { ascending: false })

    if (error) {
      console.error('Resources fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 })
    }

    const transformed = (resources || []).map((r: any) => ({
      ...r,
      tags: (r?.tags || []).map((rt: any) => rt.tag).filter(Boolean) || []
    }))

    console.log(`[Resources API] User ${userId}: Found ${transformed.length} resources`)
    console.log(`[Resources API] Resource types:`, transformed.map(r => `${r.source}:${r.type}`))

    // Cache the result for 2 minutes (per user)
    apiCache.set(cacheKey, transformed, 2 * 60 * 1000)

    return NextResponse.json({ resources: transformed })
  } catch (error) {
    console.error('Resources API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}