import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createOAuthClient, extractFileIdFromUrl } from '@/lib/google-docs'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

// Force dynamic rendering for OAuth routes
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const oauth2Client = createOAuthClient()
    
    // Generate OAuth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/documents.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events.readonly',
        'openid',
        'email',
        'profile'
      ],
      state: userId, // Pass user ID in state
      prompt: 'consent' // Force consent screen to get refresh token
    })

    return NextResponse.json({ authUrl })
  } catch (error) {
    console.error('Google OAuth start error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}



