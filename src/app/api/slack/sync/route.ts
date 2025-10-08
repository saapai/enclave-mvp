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

    console.log(`Starting Slack channel sync: ${channel.channel_name}`)

    // Index the channel (fetch messages and create embeddings)
    const result = await indexSlackChannel(
      slackAccount.id,
      channelId,
      slackAccount.space_id,
      slackAccount.access_token,
      channel.channel_name,
      channel.last_message_ts
    )

    console.log(`Slack sync complete: ${result.messageCount} messages indexed`)

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

