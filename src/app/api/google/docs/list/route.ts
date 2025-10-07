import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all Google Docs for this user
    const { data: googleDocs, error } = await supabase
      .from('sources_google_docs')
      .select('*')
      .eq('added_by', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching Google Docs:', error)
      return NextResponse.json({ error: 'Failed to fetch Google Docs' }, { status: 500 })
    }

    return NextResponse.json({ googleDocs: googleDocs || [] })
  } catch (error) {
    console.error('Google Docs list error:', error)
    return NextResponse.json({ 
      error: 'Failed to list Google Docs',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

