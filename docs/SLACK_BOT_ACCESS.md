# Slack Bot Access Guide

## Why Channels Show "0 messages"

When you connect Slack to Enclave, you'll see all channels you're a member of listed, but many will show **"0 messages"**. This is **expected behavior** due to how Slack's security model works.

## How Slack Bot Access Works

### The Security Model

Slack uses a strict security model for bot access:

1. **User Token** (from `user_scope`):
   - Lists all channels the **user** is a member of
   - Cannot read message history
   - Used for: Channel discovery

2. **Bot Token** (from `scope`):
   - Can ONLY access channels where the **bot** is explicitly added
   - Can read message history from those channels
   - Used for: Reading messages, syncing data

### Why This Matters

- ✅ **You** can see all your channels (via user token)
- ❌ **The bot** can only access channels it's been invited to (via bot token)
- 🔒 This is a Slack security requirement to protect private channel data

## How to Sync Messages from a Channel

To sync messages from any channel:

### Step 1: Add the Bot to the Channel

**In Slack:**
1. Open the channel you want to sync
2. Click the channel name at the top
3. Click "Integrations" tab
4. Click "Add apps"
5. Search for your Enclave bot
6. Click "Add"

### Step 2: Sync in Enclave

**In Enclave:**
1. Open the Slack dialog
2. Find the channel (it will still show "0 messages")
3. Click the "Sync" button
4. Messages will now be fetched and indexed!

## Auto-Sync Behavior

### During Initial Connection

When you first connect Slack:
- ✅ All channels you're in are discovered
- ✅ Bot attempts to sync messages from all channels
- ⚠️ Only channels where bot is a member will sync successfully
- ℹ️ Other channels are skipped (not an error)

### After Adding Bot to a Channel

Once you add the bot to a channel in Slack:
1. Click "Sync" in Enclave
2. Messages will be fetched
3. Embeddings will be created
4. Channel becomes searchable!

## Best Practices

### For Maximum Coverage

To make all your Slack messages searchable:

1. **Identify Important Channels**
   - Which channels have valuable information?
   - Which channels do you query most often?

2. **Add Bot Strategically**
   - Add bot to high-value channels
   - Public channels: Anyone can add the bot
   - Private channels: Admin/owner must add the bot

3. **Sync Regularly**
   - Click "Sync" after adding bot to new channels
   - Enclave will fetch all historical messages
   - Future messages will be indexed automatically (coming soon)

### For Privacy

**Channels you DON'T add the bot to:**
- ❌ Bot cannot access
- ❌ Messages not synced
- ❌ Not searchable in Enclave
- ✅ Remain private in Slack

This gives you **granular control** over what data Enclave can access.

## Troubleshooting

### "Failed to sync" Error

**Cause:** Bot is not in the channel

**Solution:**
1. Add bot to channel in Slack (see Step 1 above)
2. Try syncing again in Enclave

### Channel Shows "0 messages" After Sync

**Possible Causes:**
1. Bot still not in channel → Add bot in Slack
2. Channel is empty → No messages to sync
3. All messages are from bots → Bot messages are filtered out

### How to Check if Bot is in Channel

**In Slack:**
1. Open the channel
2. Look at the member list
3. Search for your Enclave bot
4. If not there → Add it!

## Technical Details

### API Endpoints Used

- `users.conversations`: Lists channels user is in (user token)
- `conversations.history`: Fetches messages (bot token)
- `conversations.replies`: Fetches thread replies (bot token)

### Error Handling

When syncing, if bot encounters:
- `channel_not_found`: Bot not in channel → Skips gracefully
- `not_in_channel`: Bot not in channel → Skips gracefully
- Other errors → Logged for debugging

### Message Processing

For each synced channel:
1. Fetch all messages (paginated)
2. Fetch thread replies for threaded messages
3. Create embeddings for semantic search
4. Store in database with metadata:
   - Channel context
   - Thread context
   - Timestamp
   - User info

## Future Enhancements

Coming soon:
- 🔄 Real-time sync via Slack Events API
- 📊 Sync status dashboard
- ⚡ Bulk bot addition to multiple channels
- 🔔 Notifications when new channels are available

## Summary

**Remember:**
- Seeing channels with "0 messages" is **normal**
- You control which channels the bot can access
- Add bot → Sync → Search! 🚀

