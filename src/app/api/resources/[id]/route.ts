import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase, supabaseAdmin } from '@/lib/supabase'
import { apiCache, CACHE_KEYS } from '@/lib/cache'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth()
    const isDev = process.env.NODE_ENV !== 'production'
    if (!userId && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resourceId = params.id
    if (!resourceId) {
      return NextResponse.json({ error: 'Resource ID is required' }, { status: 400 })
    }

    // Use admin client to bypass RLS (auth is validated at route level with Clerk)
    const dbClient = supabaseAdmin || supabase

    // First verify the user owns this resource
    const { data: resource, error: fetchError } = await dbClient
      .from('resource')
      .select('created_by')
      .eq('id', resourceId)
      .single()

    if (fetchError || !resource) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    }

    if (resource.created_by !== userId) {
      return NextResponse.json({ error: 'Unauthorized to delete this resource' }, { status: 403 })
    }

    // Delete associated tags first
    await dbClient
      .from('resource_tag')
      .delete()
      .eq('resource_id', resourceId)

    // Delete event metadata if exists
    await dbClient
      .from('event_meta')
      .delete()
      .eq('resource_id', resourceId)

    // Delete the resource
    const { error } = await dbClient
      .from('resource')
      .delete()
      .eq('id', resourceId)

    if (error) {
      console.error('Delete resource error:', error)
      return NextResponse.json({ error: 'Failed to delete resource' }, { status: 500 })
    }

    // Clear cache after deletion (both generic and user-specific)
    apiCache.delete(CACHE_KEYS.RESOURCES)
    if (userId) {
      apiCache.delete(`${CACHE_KEYS.RESOURCES}_${userId}`)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete resource API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
