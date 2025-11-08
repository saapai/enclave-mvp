import { NextRequest, NextResponse } from 'next/server'
import { createOAuthClient } from '@/lib/google-docs'

export async function GET(request: NextRequest) {
  try {
    // Test OAuth client creation
    const oauth2Client = createOAuthClient()
    
    // Test URL extraction
    const testUrl = 'https://docs.google.com/document/d/1abc123def456/edit'
    const fileId = testUrl.match(/\/document\/d\/([a-zA-Z0-9-_]+)/)?.[1]
    
    return NextResponse.json({
      success: true,
      oauthClientCreated: !!oauth2Client,
      testUrlExtraction: fileId,
      environment: {
        hasClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
        hasRedirectUri: !!process.env.GOOGLE_REDIRECT_URI
      }
    })
  } catch (error) {
    console.error('Google Docs test error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}










