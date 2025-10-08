import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getSlackAccount, indexSlackChannel } from '@/lib/slack'

// POST /api/slack/sync - Sync messages from a Slack channel
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { channelId } = await request.json()
    if (!channelId) {
      return NextResponse.json({ error: 'Channel ID required' }, { status: 400 })
    }

    // Get Slack account
    const slackAccount = await getSlackAccount(userId)
    if (!slackAccount) {
      return NextResponse.json({ error: 'Slack not connected' }, { status: 404 })
    }

    // Get channel info
    const { data: channel, error: channelError } = await supabase
      .from('slack_channels')
      .select('*')
      .eq('id', channelId)
      .eq('slack_account_id', slackAccount.id)
      .single()

    if (channelError || !channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    console.log(`[Sync] Starting Slack channel sync: ${channel.channel_name}`)
    console.log(`[Sync] Channel details:`, {
      channelId: channel.slack_channel_id,
      channelName: channel.channel_name,
      isPrivate: channel.channel_type === 'private_channel',
      isMember: channel.is_member,
      lastMessageTs: channel.last_message_ts
    })
    console.log(`[Sync] Using bot token: ${slackAccount.bot_token?.substring(0, 20)}...`)

    // Index the channel (fetch messages and create embeddings)
    // Pass BOTH IDs: database UUID for storing, Slack ID for API calls
    const result = await indexSlackChannel(
      slackAccount.id,
      channelId,                     // Database UUID for storing messages
      channel.slack_channel_id,      // Slack channel ID for API calls (e.g., CH1N9B44C)
      slackAccount.space_id,
      slackAccount.bot_token,
      channel.channel_name,
      channel.last_message_ts
    )

    console.log(`[Sync] ✓ Slack sync complete: ${result.messageCount} messages indexed for ${channel.channel_name}`)

    return NextResponse.json({
      success: true,
      channelName: channel.channel_name,
      messageCount: result.messageCount,
      lastTs: result.lastTs
    })
  } catch (error) {
    console.error('Slack sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync Slack channel' },
      { status: 500 }
    )
  }
}

