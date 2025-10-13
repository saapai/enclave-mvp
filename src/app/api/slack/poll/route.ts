import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getSlackAccount, fetchSlackMessages, storeSlackMessage, fetchSlackThreadReplies, generateThreadSummary } from '@/lib/slack'

// POST /api/slack/poll - Poll for new messages across all auto-sync channels
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get Slack account
    const slackAccount = await getSlackAccount(userId)
    if (!slackAccount) {
      return NextResponse.json({ error: 'Slack not connected' }, { status: 404 })
    }

    // Get all channels with auto_sync enabled
    const { data: channels, error: channelsError } = await supabase
      .from('slack_channels')
      .select('*')
      .eq('slack_account_id', slackAccount.id)
      .eq('auto_sync', true)

    if (channelsError) {
      console.error('Failed to fetch auto-sync channels:', channelsError)
      return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
    }

    if (!channels || channels.length === 0) {
      return NextResponse.json({ 
        message: 'No auto-sync channels configured',
        channelsPolled: 0,
        newMessages: 0
      })
    }

    let totalNewMessages = 0
    const channelsUpdated: string[] = []

    // Poll each channel for new messages
    for (const channel of channels) {
      try {
        // Fetch messages since last sync
        const messages = await fetchSlackMessages(
          slackAccount.access_token,
          channel.slack_channel_id,
          channel.last_message_ts,
          50 // Limit to recent messages
        )

        if (messages.length === 0) continue

        // Store new messages
        for (const message of messages) {
          // Skip bot messages and system messages
          if (message.subtype && message.subtype !== 'thread_broadcast') continue

          let threadContext: string | undefined

          // If message is in a thread, fetch thread context
          if (message.thread_ts && message.thread_ts !== message.ts) {
            try {
              const threadMessages = await fetchSlackThreadReplies(
                slackAccount.access_token,
                channel.slack_channel_id,
                message.thread_ts
              )
              threadContext = await generateThreadSummary(threadMessages)
            } catch (error) {
              console.error(`Failed to fetch thread context for message ${message.ts}:`, error)
            }
          }

          await storeSlackMessage(
            channel.id,
            channel.space_id,
            message,
            channel.channel_name,
            threadContext
          )

          totalNewMessages++
        }

        // Update channel metadata
        await supabase
          .from('slack_channels')
          .update({
            last_indexed_at: new Date().toISOString(),
            last_message_ts: messages[0].ts,
            message_count: channel.message_count + messages.length
          })
          .eq('id', channel.id)

        channelsUpdated.push(channel.channel_name)
      } catch (error) {
        console.error(`Failed to poll channel ${channel.channel_name}:`, error)
        // Continue with other channels
      }
    }

    console.log(`Slack poll complete: ${totalNewMessages} new messages from ${channelsUpdated.length} channels`)

    return NextResponse.json({
      success: true,
      channelsPolled: channels.length,
      channelsUpdated: channelsUpdated.length,
      newMessages: totalNewMessages,
      updatedChannels: channelsUpdated
    })
  } catch (error) {
    console.error('Slack poll error:', error)
    return NextResponse.json(
      { error: 'Failed to poll Slack messages' },
      { status: 500 }
    )
  }
}


