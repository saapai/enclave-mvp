# Slack Integration Deployment for tryenclave.com

## Slack App Configuration

### App Credentials (Generated)
- **Client ID**: `[YOUR_SLACK_CLIENT_ID]`
- **Client Secret**: `[YOUR_SLACK_CLIENT_SECRET]`
- **App Token**: `[YOUR_SLACK_APP_TOKEN]`

### Required OAuth Scopes
Make sure your Slack app has these scopes configured:

**Bot Token Scopes:**
- `channels:history` - Read messages from public channels
- `channels:read` - View basic channel information
- `groups:history` - Read messages from private channels
- `groups:read` - View basic private channel information
- `im:history` - Read direct messages
- `im:read` - View basic DM information
- `mpim:history` - Read group DM messages
- `mpim:read` - View basic group DM information
- `users:read` - View user information
- `team:read` - View workspace information

### Redirect URLs
Add this URL to your Slack app's OAuth & Permissions:
```
https://tryenclave.com/api/oauth/slack/callback
```

## Vercel Environment Variables

Add these environment variables to your Vercel project:

```bash
# Slack Integration
SLACK_CLIENT_ID=[YOUR_SLACK_CLIENT_ID]
SLACK_CLIENT_SECRET=[YOUR_SLACK_CLIENT_SECRET]

# App URL
NEXT_PUBLIC_APP_URL=https://tryenclave.com
```

## Database Setup

### 1. Run Slack Schema
Execute this SQL in your Supabase SQL Editor:

```sql
-- Run the contents of database/slack-schema.sql
-- This creates all necessary tables for Slack integration
```

### 2. Verify Tables
Check that these tables exist:
- slack_accounts
- slack_channels  
- slack_messages
- slack_message_chunks

## Testing the Integration

### 1. Deploy to Production
```bash
git push origin main
# Vercel will automatically deploy
```

### 2. Test OAuth Flow
1. Go to https://tryenclave.com
2. Click the "Slack" button
3. Authorize the app in your workspace
4. You should be redirected back to tryenclave.com

### 3. Test Channel Sync
1. Open the Slack dialog
2. Click "Sync" on any channel
3. Wait for messages to be indexed
4. Test search with a query that should match Slack messages

## Troubleshooting

### OAuth Issues
- Verify redirect URL matches exactly: `https://tryenclave.com/api/oauth/slack/callback`
- Check that environment variables are set in Vercel
- Ensure Slack app has correct scopes

### Database Issues
- Verify slack-schema.sql was executed
- Check Supabase logs for any SQL errors
- Ensure pgvector extension is enabled

### Search Issues
- Check that messages were synced (message_count > 0)
- Verify embeddings were generated
- Test with simple queries first

## Security Notes

- Client Secret should only be in server-side environment variables
- App Token is for Slack API calls (if needed for webhooks later)
- All OAuth tokens are stored encrypted in Supabase
- Users can only access channels they're members of

## Next Steps

After successful deployment:
1. Test the complete OAuth flow
2. Sync a test channel
3. Verify search results include Slack messages
4. Monitor for any errors in Vercel logs
5. Consider setting up Slack Events API for real-time updates (future enhancement)
