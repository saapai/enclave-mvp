import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // First, get the slack account IDs for this user
    const { data: slackAccounts, error: fetchError } = await supabase
      .from('slack_accounts')
      .select('id')
      .eq('user_id', userId)

    if (fetchError) {
      console.error('Error fetching Slack accounts:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
    }

    if (!slackAccounts || slackAccounts.length === 0) {
      return NextResponse.json({ message: 'No Slack accounts to disconnect' })
    }

    const accountIds = slackAccounts.map(acc => acc.id)

    // Delete channels (this will cascade delete messages and chunks via ON DELETE CASCADE)
    const { error: channelsError } = await supabase
      .from('slack_channels')
      .delete()
      .in('slack_account_id', accountIds)

    if (channelsError) {
      console.error('Error deleting Slack channels:', channelsError)
      return NextResponse.json({ error: 'Failed to delete channels' }, { status: 500 })
    }

    // Delete the slack accounts (should already be clean due to CASCADE, but being explicit)
    const { error: accountsError } = await supabase
      .from('slack_accounts')
      .delete()
      .eq('user_id', userId)

    if (accountsError) {
      console.error('Error deleting Slack account:', accountsError)
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    console.log(`Slack disconnected for user ${userId} (deleted ${accountIds.length} account(s))`)

    return NextResponse.json({ message: 'Slack disconnected successfully' })
  } catch (error) {
    console.error('Slack disconnect error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
