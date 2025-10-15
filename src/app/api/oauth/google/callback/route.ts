import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createOAuthClient, storeGoogleTokens } from '@/lib/google-docs'

// Force dynamic rendering for OAuth routes
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.redirect(new URL('/sign-in', request.url))
    }

    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(new URL('/?error=google_auth_failed', request.url))
    }

    if (!code || state !== userId) {
      return NextResponse.redirect(new URL('/?error=invalid_auth', request.url))
    }

    const oauth2Client = createOAuthClient()
    
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code)
    
    // Get user info
    oauth2Client.setCredentials(tokens)
    const oauth2 = await import('googleapis').then(g => g.google.oauth2('v2'))
    const userInfo = await oauth2.userinfo.get({ auth: oauth2Client })
    
    // Store tokens
    await storeGoogleTokens(
      userId,
      userInfo.data.id!,
      userInfo.data.email!,
      tokens
    )

    return NextResponse.redirect(new URL('/?google_connected=true', request.url))
  } catch (error) {
    console.error('Google OAuth callback error:', error)
    return NextResponse.redirect(new URL('/?error=google_auth_failed', request.url))
  }
}




