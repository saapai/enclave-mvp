import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { exchangeSlackCode, storeSlackAccount, fetchSlackChannels, storeSlackChannel } from '@/lib/slack'
import { supabase } from '@/lib/supabase'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.redirect(new URL('/sign-in', request.url))
    }

    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const state = searchParams.get('state')

    if (error) {
      console.error('Slack OAuth error:', error)
      return NextResponse.redirect(
        new URL(`/?error=slack_oauth_${error}`, request.url)
      )
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/?error=slack_no_code', request.url)
      )
    }

    // Verify state matches user ID
    if (state !== userId) {
      return NextResponse.redirect(
        new URL('/?error=slack_state_mismatch', request.url)
      )
    }

    // Exchange code for access token
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const redirectUri = `${appUrl}/api/oauth/slack/callback`

    const slackAuth = await exchangeSlackCode(code, redirectUri)

    // Store Slack account
    const slackAccount = await storeSlackAccount(
      userId,
      DEFAULT_SPACE_ID, // For now, store in default space
      slackAuth.botToken,
      slackAuth.userToken,
      slackAuth.teamId,
      slackAuth.teamName,
      slackAuth.botUserId,
      slackAuth.refreshToken,
      slackAuth.expiresIn
    )

    console.log(`Slack workspace connected: ${slackAuth.teamName} for user ${userId}`)

    // Fetch and store channels using user token
    console.log('Fetching Slack channels...')
    const channels = await fetchSlackChannels(slackAuth.userToken)
    console.log(`Fetched ${channels.length} total channels from Slack`)
    
    let storedCount = 0
    for (const channel of channels) {
      try {
        // Store all channels (member and non-member)
        // The is_member field will help us know which ones to sync
        await storeSlackChannel(
          slackAccount.id,
          DEFAULT_SPACE_ID,
          channel.id,
          channel.name,
          channel.is_private ? 'private_channel' : 'public_channel',
          channel.is_archived || false,
          channel.is_member || false
        )
        storedCount++
      } catch (error) {
        console.error(`Failed to store channel ${channel.name}:`, error)
      }
    }

    console.log(`Stored ${storedCount} Slack channels (${channels.filter((c: any) => c.is_member).length} member channels)`)

    // Automatically sync messages from all member channels
    const memberChannels = channels.filter((c: any) => c.is_member)
    console.log(`Auto-syncing messages from ${memberChannels.length} member channels...`)
    
    for (const channel of memberChannels) {
      try {
        // Find the stored channel in database
        const { data: storedChannel } = await supabase
          .from('slack_channels')
          .select('id')
          .eq('slack_channel_id', channel.id)
          .eq('slack_account_id', slackAccount.id)
          .single()

        if (storedChannel) {
          // Import the sync function
          const { fetchSlackMessages, storeSlackMessages } = await import('@/lib/slack')
          
          // Fetch and store messages from this channel using bot token
          console.log(`Syncing messages from #${channel.name}...`)
          const messages = await fetchSlackMessages(slackAuth.botToken, channel.id)
          
          if (messages.length > 0) {
            await storeSlackMessages(
              storedChannel.id,
              DEFAULT_SPACE_ID,
              messages,
              slackAuth.botToken  // Use bot token for fetching user info
            )
            console.log(`Synced ${messages.length} messages from #${channel.name}`)
          } else {
            console.log(`No messages found in #${channel.name} (bot may not be in channel)`)
          }
        }
      } catch (error) {
        console.error(`Failed to sync messages from channel ${channel.name}:`, error)
        // Continue with other channels even if one fails
      }
    }

    console.log('Slack connection and message sync completed')

    // Redirect back to home page with success message
    return NextResponse.redirect(
      new URL('/?slack_connected=true', request.url)
    )
  } catch (error) {
    console.error('Slack OAuth callback error:', error)
    return NextResponse.redirect(
      new URL('/?error=slack_callback_failed', request.url)
    )
  }
}

