import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
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

    // Delete associated tags first
    await supabase
      .from('resource_tag')
      .delete()
      .eq('resource_id', resourceId)

    // Delete event metadata if exists
    await supabase
      .from('event_meta')
      .delete()
      .eq('resource_id', resourceId)

    // Delete the resource
    const { error } = await supabase
      .from('resource')
      .delete()
      .eq('id', resourceId)

    if (error) {
      console.error('Delete resource error:', error)
      return NextResponse.json({ error: 'Failed to delete resource' }, { status: 500 })
    }

    // Clear cache after deletion
    apiCache.delete(CACHE_KEYS.RESOURCES)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete resource API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
