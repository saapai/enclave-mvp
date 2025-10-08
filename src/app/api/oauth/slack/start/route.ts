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

    // Slack OAuth scopes - we need BOTH user and bot scopes
    // User scopes: to get channels user is member of
    const userScopes = [
      'channels:read',
      'groups:read',
      'im:read',
      'mpim:read',
      'users:read'
    ].join(',')

    // Bot scopes: to read message history (user tokens can't read history)
    const botScopes = [
      'channels:history',
      'groups:history',
      'im:history',
      'mpim:history',
      'chat:write',  // For potential future features
      'users:read'
    ].join(',')

    // Build Slack OAuth URL with BOTH user and bot scopes
    const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize')
    slackAuthUrl.searchParams.set('client_id', clientId)
    slackAuthUrl.searchParams.set('scope', botScopes)  // Bot scopes for reading messages
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

