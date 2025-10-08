import { supabase } from './supabase'
import { embedText } from './embeddings'

export interface SlackAccount {
  id: string
  user_id: string
  space_id: string
  bot_token: string
  user_token: string
  refresh_token?: string
  token_expiry?: Date
  team_id: string
  team_name: string
  bot_user_id?: string
  created_at: Date
  updated_at: Date
}

export interface SlackChannel {
  id: string
  slack_account_id: string
  space_id: string
  slack_channel_id: string
  channel_name: string
  channel_type: string
  is_archived: boolean
  is_member: boolean
  last_indexed_at?: Date
  last_message_ts?: string
  message_count: number
  auto_sync: boolean
  created_at: Date
  updated_at: Date
}

export interface SlackMessage {
  id: string
  slack_channel_id: string
  space_id: string
  slack_message_id: string
  thread_ts?: string
  user_id?: string
  username?: string
  text: string
  is_thread_parent: boolean
  reply_count: number
  thread_context?: string
  has_files: boolean
  file_urls?: string[]
  posted_at: Date
  created_at: Date
  updated_at: Date
}

export interface SlackMessageChunk {
  text: string
  thread_context?: string
  channel_context?: string
  embedding?: number[]
}

// Slack API base URL
const SLACK_API_BASE = 'https://slack.com/api'

/**
 * Exchange OAuth code for access token
 */
export async function exchangeSlackCode(code: string, redirectUri: string) {
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Slack OAuth credentials not configured')
  }

  const response = await fetch(`${SLACK_API_BASE}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  })

  const data = await response.json()

  if (!data.ok) {
    throw new Error(`Slack OAuth error: ${data.error}`)
  }

  // When using both user_scope and scope, Slack returns both tokens
  // Bot token (for reading messages): data.access_token
  // User token (for listing channels): data.authed_user.access_token
  const botToken = data.access_token
  const userToken = data.authed_user?.access_token
  const refreshToken = data.refresh_token || data.authed_user?.refresh_token
  
  if (!botToken) {
    throw new Error('No bot access token received from Slack')
  }
  
  if (!userToken) {
    throw new Error('No user access token received from Slack')
  }

  return {
    botToken,
    userToken,
    refreshToken,
    teamId: data.team.id,
    teamName: data.team.name,
    botUserId: data.bot_user_id,
    expiresIn: data.expires_in
  }
}

/**
 * Store Slack account in database
 */
export async function storeSlackAccount(
  userId: string,
  spaceId: string,
  botToken: string,
  userToken: string,
  teamId: string,
  teamName: string,
  botUserId?: string,
  refreshToken?: string,
  expiresIn?: number
): Promise<SlackAccount> {
  const tokenExpiry = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : undefined

  // Try the new schema first (dual tokens), fall back to old schema if needed
  let data, error
  
  try {
    // Attempt to insert with new dual token schema
    const result = await supabase
      .from('slack_accounts')
      .upsert({
        user_id: userId,
        space_id: spaceId,
        bot_token: botToken,
        user_token: userToken,
        refresh_token: refreshToken,
        token_expiry: tokenExpiry?.toISOString(),
        team_id: teamId,
        team_name: teamName,
        bot_user_id: botUserId
      }, {
        onConflict: 'user_id,team_id'
      })
      .select()
      .single()
    
    data = result.data
    error = result.error
  } catch (schemaError) {
    // If new schema fails, try old schema (backward compatibility)
    console.log('New schema failed, trying old schema:', schemaError)
    const result = await supabase
      .from('slack_accounts')
      .upsert({
        user_id: userId,
        space_id: spaceId,
        access_token: botToken, // Use bot token as access token in old schema
        refresh_token: refreshToken,
        token_expiry: tokenExpiry?.toISOString(),
        team_id: teamId,
        team_name: teamName,
        bot_user_id: botUserId
      }, {
        onConflict: 'user_id,team_id'
      })
      .select()
      .single()
    
    data = result.data
    error = result.error
  }

  if (error) throw error
  return data as SlackAccount
}

/**
 * Get Slack account for user
 */
export async function getSlackAccount(userId: string): Promise<SlackAccount | null> {
  const { data, error } = await supabase
    .from('slack_accounts')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }

  // Handle backward compatibility: if we have old schema with access_token,
  // map it to both bot_token and user_token
  const account = data as any
  if (account.access_token && !account.bot_token) {
    return {
      ...account,
      bot_token: account.access_token,
      user_token: account.access_token // Temporary: same token for both
    } as SlackAccount
  }

  return data as SlackAccount
}

/**
 * Fetch channels from Slack API
 */
export async function fetchSlackChannels(accessToken: string): Promise<any[]> {
  let allChannels: any[] = []
  let cursor: string | undefined = undefined
  let hasMore = true

  // Use users.conversations to get only channels the user is a member of
  // This automatically filters to member channels and includes private channels
  while (hasMore) {
    const params = new URLSearchParams({
      exclude_archived: 'false',
      types: 'public_channel,private_channel',
      limit: '200'
    })

    if (cursor) {
      params.append('cursor', cursor)
    }

    // Changed from conversations.list to users.conversations
    // This returns only channels where the user is a member
    const response = await fetch(
      `${SLACK_API_BASE}/users.conversations?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )

    const data = await response.json()

    if (!data.ok) {
      console.error('Slack API error:', data.error)
      throw new Error(`Slack API error: ${data.error}`)
    }

    // Mark all returned channels as member channels since users.conversations only returns member channels
    const memberChannels = (data.channels || []).map((channel: any) => ({
      ...channel,
      is_member: true // Force is_member to true since this API only returns member channels
    }))

    allChannels = allChannels.concat(memberChannels)
    
    // Check if there are more pages
    cursor = data.response_metadata?.next_cursor
    hasMore = !!cursor
  }

  console.log(`Fetched ${allChannels.length} channels from Slack (all are member channels)`)
  return allChannels
}

/**
 * Store Slack channel in database
 */
export async function storeSlackChannel(
  slackAccountId: string,
  spaceId: string,
  channelId: string,
  channelName: string,
  channelType: string,
  isArchived: boolean,
  isMember: boolean
): Promise<SlackChannel> {
  const { data, error } = await supabase
    .from('slack_channels')
    .upsert({
      slack_account_id: slackAccountId,
      space_id: spaceId,
      slack_channel_id: channelId,
      channel_name: channelName,
      channel_type: channelType,
      is_archived: isArchived,
      is_member: isMember,
      auto_sync: true
    }, {
      onConflict: 'slack_account_id,slack_channel_id'
    })
    .select()
    .single()

  if (error) throw error
  return data as SlackChannel
}

/**
 * Fetch messages from a Slack channel
 */
export async function fetchSlackMessages(
  accessToken: string,
  channelId: string,
  oldest?: string,
  limit: number = 100
): Promise<any[]> {
  const params = new URLSearchParams({
    channel: channelId,
    limit: limit.toString()
  })

  if (oldest) {
    params.append('oldest', oldest)
  }

  const response = await fetch(
    `${SLACK_API_BASE}/conversations.history?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  )

  const data = await response.json()

  if (!data.ok) {
    // If channel_not_found or not_in_channel, the bot isn't in the channel
    // This is expected for channels the bot hasn't been added to
    if (data.error === 'channel_not_found' || data.error === 'not_in_channel') {
      console.log(`Bot not in channel ${channelId}, skipping message fetch`)
      return []
    }
    throw new Error(`Slack API error: ${data.error}`)
  }

  return data.messages || []
}

/**
 * Fetch thread replies for a message
 */
export async function fetchSlackThreadReplies(
  accessToken: string,
  channelId: string,
  threadTs: string
): Promise<any[]> {
  const response = await fetch(
    `${SLACK_API_BASE}/conversations.replies?channel=${channelId}&ts=${threadTs}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  )

  const data = await response.json()

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`)
  }

  return data.messages || []
}

/**
 * Generate thread context summary using AI
 */
export async function generateThreadSummary(messages: any[]): Promise<string> {
  if (messages.length === 0) return ''
  if (messages.length === 1) return messages[0].text || ''

  // Combine all messages in thread
  const threadText = messages
    .map((m, i) => `[${i + 1}] ${m.user}: ${m.text}`)
    .join('\n')

  // For now, just return a simple summary
  // TODO: Use AI to generate proper summary
  return `Thread with ${messages.length} messages`
}

/**
 * Store Slack message and create embeddings
 */
export async function storeSlackMessage(
  slackChannelId: string,
  spaceId: string,
  message: any,
  channelName: string,
  threadContext?: string
): Promise<SlackMessage> {
  const { data: storedMessage, error: messageError } = await supabase
    .from('slack_messages')
    .upsert({
      slack_channel_id: slackChannelId,
      space_id: spaceId,
      slack_message_id: message.ts,
      thread_ts: message.thread_ts || null,
      user_id: message.user,
      username: message.username || message.user,
      text: message.text || '',
      is_thread_parent: !!message.reply_count,
      reply_count: message.reply_count || 0,
      thread_context: threadContext,
      has_files: !!(message.files && message.files.length > 0),
      file_urls: message.files?.map((f: any) => f.url_private) || [],
      posted_at: new Date(parseFloat(message.ts) * 1000).toISOString()
    }, {
      onConflict: 'slack_channel_id,slack_message_id'
    })
    .select()
    .single()

  if (messageError) throw messageError

  // Create embedding for message
  await storeSlackMessageChunk(
    storedMessage.id,
    slackChannelId,
    spaceId,
    message.text || '',
    threadContext,
    channelName
  )

  return storedMessage as SlackMessage
}

/**
 * Create and store message chunk with embedding
 */
async function storeSlackMessageChunk(
  messageId: string,
  channelId: string,
  spaceId: string,
  text: string,
  threadContext?: string,
  channelContext?: string
): Promise<void> {
  if (!text.trim()) return

  // Generate embedding
  const embedding = await embedText(text)

  // Store chunk
  await supabase
    .from('slack_message_chunks')
    .insert({
      slack_message_id: messageId,
      slack_channel_id: channelId,
      space_id: spaceId,
      text,
      chunk_index: 0,
      thread_context: threadContext,
      channel_context: channelContext,
      embedding
    })
}

/**
 * Index a Slack channel (fetch and store all messages)
 */
export async function indexSlackChannel(
  slackAccountId: string,
  channelId: string,
  spaceId: string,
  accessToken: string,
  channelName: string,
  lastMessageTs?: string
): Promise<{ messageCount: number; lastTs: string }> {
  let allMessages: any[] = []
  let oldest = lastMessageTs
  let hasMore = true

  // Fetch all messages (with pagination)
  while (hasMore) {
    const messages = await fetchSlackMessages(accessToken, channelId, oldest, 100)
    
    if (messages.length === 0) {
      hasMore = false
      break
    }

    allMessages = [...allMessages, ...messages]
    oldest = messages[messages.length - 1].ts
    hasMore = messages.length === 100 // If we got 100, there might be more
  }

  // Store messages and create embeddings
  for (const message of allMessages) {
    // Skip bot messages and system messages
    if (message.subtype && message.subtype !== 'thread_broadcast') continue

    let threadContext: string | undefined

    // If message is in a thread, fetch thread context
    if (message.thread_ts && message.thread_ts !== message.ts) {
      const threadMessages = await fetchSlackThreadReplies(
        accessToken,
        channelId,
        message.thread_ts
      )
      threadContext = await generateThreadSummary(threadMessages)
    }

    await storeSlackMessage(
      channelId,
      spaceId,
      message,
      channelName,
      threadContext
    )
  }

  // Update channel metadata
  await supabase
    .from('slack_channels')
    .update({
      last_indexed_at: new Date().toISOString(),
      last_message_ts: allMessages[0]?.ts,
      message_count: allMessages.length
    })
    .eq('id', channelId)

  return {
    messageCount: allMessages.length,
    lastTs: allMessages[0]?.ts || ''
  }
}

/**
 * Search Slack messages by vector similarity
 */
export async function searchSlackMessages(
  queryEmbedding: number[],
  spaceId: string,
  limit: number = 10
): Promise<any[]> {
  const { data, error } = await supabase.rpc('search_slack_messages_vector', {
    query_embedding: queryEmbedding,
    target_space_id: spaceId,
    limit_count: limit,
    offset_count: 0
  })

  if (error) {
    console.error('Slack search error:', error)
    return []
  }

  return data || []
}

