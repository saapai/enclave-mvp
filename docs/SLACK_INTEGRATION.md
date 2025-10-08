# Slack Integration Setup Guide

## Overview

The Slack integration allows you to import messages from your Slack workspace into Enclave, making them searchable alongside your other resources. It includes:

- **Thread-aware indexing**: Preserves thread context for better search results
- **Channel awareness**: Maintains channel context in search results
- **Semantic search**: Uses vector embeddings for intelligent message search
- **Automatic sync**: Keep messages up-to-date with manual sync

## Prerequisites

1. **Slack Workspace Admin Access**: You need permission to create Slack apps
2. **Supabase Database**: Slack tables must be created
3. **Enclave Running**: Your Enclave instance must be deployed

## Step 1: Create a Slack App

### 1.1 Go to Slack API Portal

1. Visit [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"**
3. Choose **"From scratch"**
4. Enter app name: `Enclave` (or your preferred name)
5. Select your workspace
6. Click **"Create App"**

### 1.2 Configure OAuth Scopes

1. In the left sidebar, click **"OAuth & Permissions"**
2. Scroll down to **"Scopes"**
3. Under **"Bot Token Scopes"**, add the following scopes:

```
channels:history     - Read messages from public channels
channels:read        - View basic channel information
groups:history       - Read messages from private channels
groups:read          - View basic private channel information
im:history           - Read direct messages
im:read              - View basic DM information
mpim:history         - Read group DM messages
mpim:read            - View basic group DM information
users:read           - View user information
team:read            - View workspace information
```

### 1.3 Set Redirect URLs

1. Still in **"OAuth & Permissions"**
2. Under **"Redirect URLs"**, click **"Add New Redirect URL"**
3. Add your callback URLs:
   - **Development**: `http://localhost:3000/api/oauth/slack/callback`
   - **Production**: `https://your-domain.com/api/oauth/slack/callback`
4. Click **"Add"** and then **"Save URLs"**

### 1.4 Get Your Credentials

1. In the left sidebar, click **"Basic Information"**
2. Scroll to **"App Credentials"**
3. Copy your **Client ID** and **Client Secret**
4. Keep these secure - you'll need them for environment variables

## Step 2: Database Setup

### 2.1 Run the Slack Schema SQL

1. Go to your Supabase dashboard
2. Navigate to **SQL Editor**
3. Open `database/slack-schema.sql` from your Enclave repository
4. Copy and paste the entire contents
5. Click **"Run"**

This creates the following tables:
- `slack_accounts` - Stores Slack workspace connections
- `slack_channels` - Stores channel information
- `slack_messages` - Stores individual messages
- `slack_message_chunks` - Stores message chunks with embeddings

### 2.2 Verify Tables

Check that the following tables exist:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE 'slack_%';
```

You should see:
- slack_accounts
- slack_channels
- slack_messages
- slack_message_chunks

## Step 3: Environment Configuration

### 3.1 Local Development

Add to your `.env.local`:

```bash
# Slack Integration
SLACK_CLIENT_ID=your_slack_client_id_here
SLACK_CLIENT_SECRET=your_slack_client_secret_here
```

### 3.2 Production Deployment

Add the same variables to your deployment platform:

**Vercel**:
1. Go to your project settings
2. Navigate to **Environment Variables**
3. Add `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`
4. Redeploy your application

**Other Platforms**: Follow their respective environment variable setup process

## Step 4: Using the Slack Integration

### 4.1 Connect Your Workspace

1. Log in to Enclave
2. Click the **"Slack"** button in the top navigation
3. Click **"Connect Slack"**
4. Authorize the app in your workspace
5. You'll be redirected back to Enclave

### 4.2 Sync Channels

1. Open the Slack dialog again
2. You'll see a list of all channels you're a member of
3. Click **"Sync"** on any channel to index its messages
4. Wait for the sync to complete (may take a few minutes for large channels)

### 4.3 Search Slack Messages

Once synced, Slack messages are automatically included in search results:

1. Use the main search bar
2. Your query will search across:
   - Regular resources
   - Google Docs
   - Slack messages (with thread context)
3. Results show the channel name and message context

## Features

### Thread Awareness

Messages in threads include context from the entire thread:
- Parent message is linked to all replies
- Thread summaries are generated for context
- Search results include relevant thread context

### Channel Context

Each message includes:
- Channel name
- Channel type (public/private)
- Timestamp and author information

### Smart Search

Slack messages are indexed with embeddings:
- Semantic search finds related messages even without exact keywords
- Thread context improves relevance
- Results are ranked alongside other resources

## Troubleshooting

### "Slack not connected" Error

- Make sure you've authorized the app in your workspace
- Check that OAuth credentials are correct in environment variables
- Verify redirect URLs match your deployment URL

### Messages Not Appearing in Search

- Ensure the channel has been synced (click "Sync" button)
- Check that embeddings were generated (may take time for large channels)
- Verify the search function includes Slack (check `src/lib/search.ts`)

### Sync Fails or Takes Too Long

- Slack rate limits may slow down large syncs
- Try syncing smaller channels first
- Check server logs for specific errors

### Permission Denied Errors

- Verify all OAuth scopes are added to your Slack app
- Re-authorize the app after adding new scopes
- Check that you're a member of the channel you're trying to sync

## API Reference

### OAuth Endpoints

- `GET /api/oauth/slack/start` - Initiate Slack OAuth flow
- `GET /api/oauth/slack/callback` - OAuth callback handler

### Slack API Endpoints

- `GET /api/slack/channels` - List all connected Slack channels
- `POST /api/slack/sync` - Sync messages from a specific channel

### Database Functions

- `search_slack_messages_vector(embedding, space_id, limit)` - Vector search for Slack messages
- `get_slack_thread_messages(thread_ts, channel_id)` - Get all messages in a thread

## Architecture

### Data Flow

1. **OAuth Connection**: User authorizes Enclave to access their Slack workspace
2. **Channel Discovery**: Enclave fetches list of channels user has access to
3. **Message Indexing**: When sync is triggered:
   - Fetch messages from Slack API
   - Detect and fetch thread replies
   - Generate embeddings for each message
   - Store in database with context
4. **Search Integration**: Hybrid search includes:
   - Regular resources (full-text search)
   - Google Docs (vector search)
   - Slack messages (vector search with context)

### Storage

- **Tokens**: Encrypted in `slack_accounts` table
- **Messages**: Full text in `slack_messages` table
- **Embeddings**: Vector embeddings in `slack_message_chunks` table
- **Context**: Thread and channel context preserved for search

## Security Considerations

1. **Token Storage**: OAuth tokens are stored securely in Supabase
2. **Access Control**: Users can only sync channels they're members of
3. **Data Privacy**: Messages are only searchable within the user's space
4. **Rate Limiting**: Respects Slack API rate limits

## Future Enhancements

Planned features:
- [ ] Real-time sync via Slack Events API
- [ ] Message reactions and reactions search
- [ ] File attachment indexing
- [ ] User mention search
- [ ] Channel activity analytics
- [ ] Automatic daily syncs
- [ ] Slack message permalinks in results

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs for specific errors
3. Verify all setup steps were completed
4. Ensure Slack app has correct permissions

## Additional Resources

- [Slack API Documentation](https://api.slack.com/docs)
- [OAuth 2.0 Guide](https://api.slack.com/authentication/oauth-v2)
- [Slack Scopes Reference](https://api.slack.com/scopes)

