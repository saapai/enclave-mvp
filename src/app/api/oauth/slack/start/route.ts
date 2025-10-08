import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = process.env.SLACK_CLIENT_ID
    if (!clientId) {
      return NextResponse.json(
        { error: 'Slack OAuth not configured' },
        { status: 500 }
      )
    }

    // Get the app URL for redirect
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const redirectUri = `${appUrl}/api/oauth/slack/callback`

    // Slack OAuth scopes needed for reading messages
    // Using user scopes for OAuth to get channels user is in
    const userScopes = [
      'channels:history',
      'channels:read',
      'groups:history',
      'groups:read',
      'im:history',
      'im:read',
      'mpim:history',
      'mpim:read',
      'users:read',
      'search:read'  // Needed for comprehensive search
    ].join(',')

    // Build Slack OAuth URL with user scopes
    // Note: user_scope parameter is for user tokens, scope is for bot tokens
    const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize')
    slackAuthUrl.searchParams.set('client_id', clientId)
    slackAuthUrl.searchParams.set('user_scope', userScopes)  // User scopes for accessing user's channels
    slackAuthUrl.searchParams.set('redirect_uri', redirectUri)
    slackAuthUrl.searchParams.set('state', userId) // Pass user ID in state

    return NextResponse.redirect(slackAuthUrl.toString())
  } catch (error) {
    console.error('Slack OAuth start error:', error)
    return NextResponse.json(
      { error: 'Failed to initiate Slack OAuth' },
      { status: 500 }
    )
  }
}

