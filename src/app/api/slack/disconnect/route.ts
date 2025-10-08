import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Delete all Slack-related data for this user
    const { error: channelsError } = await supabase
      .from('slack_channels')
      .delete()
      .eq('user_id', userId)

    if (channelsError) {
      console.error('Error deleting Slack channels:', channelsError)
      return NextResponse.json({ error: 'Failed to delete channels' }, { status: 500 })
    }

    const { error: messagesError } = await supabase
      .from('slack_messages')
      .delete()
      .eq('user_id', userId)

    if (messagesError) {
      console.error('Error deleting Slack messages:', messagesError)
      return NextResponse.json({ error: 'Failed to delete messages' }, { status: 500 })
    }

    const { error: messageChunksError } = await supabase
      .from('slack_message_chunks')
      .delete()
      .eq('user_id', userId)

    if (messageChunksError) {
      console.error('Error deleting Slack message chunks:', messageChunksError)
      return NextResponse.json({ error: 'Failed to delete message chunks' }, { status: 500 })
    }

    const { error: accountsError } = await supabase
      .from('slack_accounts')
      .delete()
      .eq('user_id', userId)

    if (accountsError) {
      console.error('Error deleting Slack account:', accountsError)
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    console.log(`Slack disconnected for user ${userId}`)

    return NextResponse.json({ message: 'Slack disconnected successfully' })
  } catch (error) {
    console.error('Slack disconnect error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
