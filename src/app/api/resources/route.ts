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
    const cached = apiCache.get(CACHE_KEYS.RESOURCES)
    if (cached) {
      return NextResponse.json({ resources: cached })
    }

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
      .eq('space_id', DEFAULT_SPACE_ID)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('Resources fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 })
    }

    const transformed = (resources || []).map((r: any) => ({
      ...r,
      tags: (r?.tags || []).map((rt: any) => rt.tag).filter(Boolean) || []
    }))

    // Cache the result for 2 minutes
    apiCache.set(CACHE_KEYS.RESOURCES, transformed, 2 * 60 * 1000)

    return NextResponse.json({ resources: transformed })
  } catch (error) {
    console.error('Resources API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}