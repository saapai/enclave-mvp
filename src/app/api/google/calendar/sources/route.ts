import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { listCalendarSources, deleteCalendarSource } from '@/lib/google-calendar'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sources = await listCalendarSources(userId)

    return NextResponse.json({
      success: true,
      calendars: sources
    })

  } catch (error: any) {
    console.error('Calendar sources list error:', error)
    return NextResponse.json({ 
      error: 'Failed to list calendar sources',
      details: error.message
    }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const sourceId = searchParams.get('sourceId')

    if (!sourceId) {
      return NextResponse.json({ error: 'Source ID is required' }, { status: 400 })
    }

    await deleteCalendarSource(sourceId)

    return NextResponse.json({
      success: true,
      message: 'Calendar disconnected successfully'
    })

  } catch (error: any) {
    console.error('Calendar delete error:', error)
    return NextResponse.json({ 
      error: 'Failed to delete calendar',
      details: error.message
    }, { status: 500 })
  }
}




