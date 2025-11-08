import { NextRequest, NextResponse } from 'next/server'
import { createOAuthClient } from '@/lib/google-docs'

export async function GET(request: NextRequest) {
  try {
    const oauth2Client = createOAuthClient()
    
    // Generate OAuth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/documents.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
        'openid',
        'email',
        'profile'
      ],
      state: 'test-user-id',
      prompt: 'consent'
    })

    return NextResponse.json({ 
      success: true,
      authUrl,
      clientId: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Missing',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Missing',
      redirectUri: process.env.GOOGLE_REDIRECT_URI
    })
  } catch (error) {
    console.error('OAuth test error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}










