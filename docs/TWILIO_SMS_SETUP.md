# Twilio SMS Setup for Enclave

This guide explains how to configure Twilio SMS webhooks to enable SEP (Search-Enclave-Prompt) queries via text message.

## Overview

Users can text "SEP" followed by their question to your Twilio number, and Enclave will search through their workspaces and respond via SMS.

**⚠️ You need to add your actual Twilio credentials to Vercel environment variables!**

## Prerequisites

- ✅ Twilio account created
- ✅ Campaign approved (you mentioned you have this!)
- ✅ Phone number: **+1 (XXX) XXX-XXXX** (configured in Twilio console)

## Configuration Steps

### 1. Environment Variables

Add these to your Vercel environment variables:

```bash
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=+18059198529
```

**For Vercel:**
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add the three variables above
4. Redeploy your application

### 2. Database Setup

Run the SMS query session schema in Supabase:

```bash
# Run this SQL in Supabase SQL Editor
database/sms-query-session-schema.sql
```

This creates the `sms_query_session` table to track active query sessions.

### 3. Twilio Webhook Configuration

In your Twilio Console:

1. Go to **Phone Numbers → Manage → Active numbers**
2. Click on **+1 (805) 919-8529**
3. Scroll to **Messaging Configuration**
4. Set the **Webhook URL** to:
   ```
   https://YOUR_DOMAIN.com/api/twilio/sms
   ```
5. Set **HTTP Method** to: `POST`
6. Click **Save**

### 4. SMS Opt-In Flow

Users must first opt-in to receive SMS messages. They can:

- **Web form**: Visit `https://www.tryenclave.com/sms-optin`
- **SMS**: Text `START`, `JOIN`, or `YES` to your number

### 5. SEP Query Flow

Once opted in, users can:

1. **Start a query session**: Text `SEP` to your number
2. **Ask questions**: Text any query (e.g., "when is my next meeting?")
3. **Get results**: Receive top 3 most relevant results via SMS

## How It Works

1. User texts `SEP` to +1 (805) 919-8529
2. Twilio sends webhook to `/api/twilio/sms`
3. Signature is validated for security
4. System checks if user is opted-in (`sms_optin` table)
5. Creates/activates query session (`sms_query_session` table)
6. User's workspaces are determined by their phone number
7. Next message is treated as a search query
8. Results are formatted and sent back via Twilio

## User Commands

- **SEP**: Start a query session
- **Any text**: Search query (must have active session)
- **STOP**: Unsubscribe from SMS
- **HELP**: Get help message

## Security

- ✅ Twilio signature validation on all webhooks
- ✅ Opt-in required before any messages
- ✅ Respects STOP commands (CTIA compliant)
- ✅ Only searches within user's accessible workspaces
- ✅ No personal data exposed in responses

## Testing

1. Opt in via web form at `/sms-optin`
2. Text `SEP` to your Twilio number
3. Text your question
4. Check the response!

## Troubleshooting

**Messages not being received:**
- Check Twilio console for delivery status
- Verify webhook URL is correct
- Check Vercel logs for errors

**Search not working:**
- Ensure user has phone number in `app_user` table
- Check that user has access to at least one workspace
- Verify resources exist in those workspaces

**Signature validation errors:**
- Ensure `TWILIO_AUTH_TOKEN` is set correctly
- Check that Twilio is sending the signature header
- Verify the webhook URL in Twilio matches your deployed URL

## Next Steps

After setup:
1. Add Twilio credentials to Vercel
2. Run SQL migration for `sms_query_session` table
3. Configure webhook URL in Twilio console
4. Test the flow with a known phone number
5. Update user-facing documentation

## Contact

For issues, email: try.inquiyr@gmail.com

