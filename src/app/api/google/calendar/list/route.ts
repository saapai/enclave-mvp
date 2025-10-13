import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getGoogleTokens, refreshTokensIfNeeded } from '@/lib/google-docs'
import { listCalendars } from '@/lib/google-calendar'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's Google tokens
    const googleAccount = await getGoogleTokens(userId)
    if (!googleAccount) {
      return NextResponse.json({ 
        error: 'Google account not connected',
        needsOAuth: true
      }, { status: 400 })
    }

    // Refresh tokens if needed
    let tokens
    try {
      tokens = await refreshTokensIfNeeded({
        access_token: googleAccount.access_token,
        refresh_token: googleAccount.refresh_token,
        expiry_date: new Date(googleAccount.token_expiry).getTime()
      })
    } catch (tokenError) {
      console.error('Token refresh failed:', tokenError)
      return NextResponse.json({ 
        error: 'Google account needs re-authentication',
        needsOAuth: true
      }, { status: 400 })
    }

    // List calendars
    const calendars = await listCalendars(tokens)

    return NextResponse.json({
      success: true,
      calendars: calendars.map(cal => ({
        id: cal.id,
        summary: cal.summary,
        description: cal.description,
        primary: cal.primary,
        accessRole: cal.accessRole,
        backgroundColor: cal.backgroundColor,
        foregroundColor: cal.foregroundColor
      }))
    })

  } catch (error: any) {
    console.error('Calendar list error:', error)
    return NextResponse.json({ 
      error: 'Failed to list calendars',
      details: error.message
    }, { status: 500 })
  }
}

