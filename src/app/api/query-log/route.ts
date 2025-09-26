import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { query, resultsCount, clickedResourceId } = body

    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('query_log')
      .insert({
        space_id: '00000000-0000-0000-0000-000000000000',
        user_id: userId,
        text: query,
        results_count: resultsCount || 0,
        clicked_resource_id: clickedResourceId || null
      } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ queryLog: data })
  } catch (error) {
    console.error('Query logging error:', error)
    return NextResponse.json(
      { error: 'Failed to log query' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { queryId, satisfaction } = body

    if (!queryId || !satisfaction) {
      return NextResponse.json(
        { error: 'Query ID and satisfaction are required' },
        { status: 400 }
      )
    }

    // For now, just return success - we'll implement this later
    const data = { id: queryId, satisfaction }
    const error = null

    if (error) {
      throw error
    }

    return NextResponse.json({ queryLog: data })
  } catch (error) {
    console.error('Query satisfaction update error:', error)
    return NextResponse.json(
      { error: 'Failed to update query satisfaction' },
      { status: 500 }
    )
  }
}
