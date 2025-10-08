import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getSlackAccount } from '@/lib/slack'

// GET /api/slack/channels - List all Slack channels for the user
export async function GET(request: NextRequest) {
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

    // Get all channels for this account
    const { data: channels, error } = await supabase
      .from('slack_channels')
      .select('*')
      .eq('slack_account_id', slackAccount.id)
      .order('channel_name', { ascending: true })

    if (error) {
      console.error('Failed to fetch Slack channels:', error)
      return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
    }

    return NextResponse.json({
      slackAccount: {
        id: slackAccount.id,
        teamName: slackAccount.team_name,
        teamId: slackAccount.team_id
      },
      channels: channels || []
    })
  } catch (error) {
    console.error('Slack channels API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

