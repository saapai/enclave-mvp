import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: spaceId } = await params
    if (!spaceId) {
      return NextResponse.json({ error: 'Space ID is required' }, { status: 400 })
    }

    // Get all members for this space
    const { data: members, error } = await supabase
      .from('app_user')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Members fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
    }

    return NextResponse.json({ members: members || [] })
  } catch (error) {
    console.error('Members API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
