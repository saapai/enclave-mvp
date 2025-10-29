# SMS Opt-In Feature Setup

This document describes how to set up and use the SMS opt-in feature for Enclave and Entrenched Coils.

## Overview

The SMS opt-in feature allows users to subscribe to SMS notifications for:
- Event reminders
- Role and ownership changes
- Task nudges
- Short links to documents and forms
- Weekly digests

## Database Setup

### 1. Create SMS Tables

Run the following SQL script to create the necessary tables in your Supabase database:

```bash
psql -h YOUR_SUPABASE_HOST -U postgres -d postgres -f database/sms-optin-schema.sql
```

Or execute the SQL directly in the Supabase SQL Editor:

```sql
-- See database/sms-optin-schema.sql for the full schema
```

The script creates:
- `sms_optin` table: Stores user consent and opt-in information
- `sms_message_log` table: Logs all SMS messages sent
- Helper function `handle_sms_optout()`: Handles opt-out requests

### 2. Configure Row Level Security (Optional)

If you want to add RLS policies:

```sql
-- Enable RLS
ALTER TABLE sms_optin ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_message_log ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage all records
CREATE POLICY "Service role can manage SMS opt-ins"
  ON sms_optin
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage SMS logs"
  ON sms_message_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

## Environment Variables

Add the following environment variables to your `.env.local` file:

```bash
# Twilio Configuration (for sending SMS)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number

# Airtable (optional for RSVP poll recording)
AIRTABLE_API_KEY=your_airtable_api_key
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TABLE_NAME=RSVP Responses
AIRTABLE_PUBLIC_RESULTS_URL=https://airtable.com/appXXXXXXXXXXXXXX/tblYYYYYYYYYYYYY

# Supabase Configuration (should already exist)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Available Pages

### 1. Terms of Service and Privacy Policy
- **URL**: `https://tryenclave.com/terms`
- **Description**: Comprehensive terms and privacy policy for SMS messaging
- **Features**:
  - SMS messaging terms
  - Privacy policy
  - Data collection and usage information
  - User rights and opt-out process

### 2. SMS Opt-In Form
- **URL**: `https://tryenclave.com/sms-optin`
- **Description**: User-facing form to opt in to SMS notifications
- **Features**:
  - Name and phone number collection
  - Consent checkbox with terms link
  - Phone number formatting (US format)
  - Success confirmation page
  - Alternative opt-in methods (SMS keywords)

## API Endpoints

### 1. Opt-In Endpoint

**POST** `/api/sms/optin`

Request body:
```json
{
  "name": "John Doe",
  "phone": "+15551234567",
  "method": "web_form",
  "keyword": null
}
```

Response:
```json
{
  "success": true,
  "message": "Successfully opted in to SMS notifications",
  "data": {
    "id": "uuid",
    "name": "John Doe",
    "phone": "+15551234567",
    "opted_out": false,
    "consent_timestamp": "2025-01-01T00:00:00Z"
  }
}
```

**GET** `/api/sms/optin?phone=+15551234567`

Response:
```json
{
  "optedIn": true,
  "data": {
    "id": "uuid",
    "name": "John Doe",
    "phone": "+15551234567",
    "opted_out": false
  }
}
```

### 2. Opt-Out Endpoint

**POST** `/api/sms/optout`

Request body:
```json
{
  "phone": "+15551234567"
}
```

Response:
```json
{
  "success": true,
  "message": "Successfully opted out of SMS notifications"
}
```

### 3. SMS Blast (Announcement or Poll)

**POST** `/api/sms/blast`

Body (announcement):
```json
{
  "spaceId": "<space_uuid>",
  "type": "announcement",
  "message": "Officer meeting moved to 7pm."
}
```

Body (poll):
```json
{
  "spaceId": "<space_uuid>",
  "type": "poll",
  "message": "Are you attending active meeting?",
  "options": ["Yes", "No", "Maybe"]
}
```

Notes:
- Sends to app users in the space who are opted-in via sms_optin.
- Polls include a 4-char code. Members reply with the letter (A, B, C...).
- Replies are recorded to Supabase (sms_poll_response) and, if configured, to Airtable.
 - If AIRTABLE_PUBLIC_RESULTS_URL is set, poll texts include a "View results" link to Airtable. Otherwise, they link to the base URL if AIRTABLE_BASE_ID is set.

## Twilio Integration (TODO)

The current implementation includes placeholders for Twilio integration. To enable SMS sending:

1. Install Twilio SDK:
```bash
npm install twilio
```

2. Update `/api/sms/optin/route.ts` to send confirmation SMS:
```typescript
import twilio from 'twilio'

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

// After successful opt-in:
await client.messages.create({
  body: "[Enclave] You're opted in for updates and reminders. Up to 6 msgs/mo. Msg&Data rates may apply. Reply HELP for help, STOP to opt out.",
  from: process.env.TWILIO_PHONE_NUMBER,
  to: phone,
})
```

3. Set up Twilio webhook to handle STOP/START/HELP keywords:
   - Create endpoint `/api/webhooks/twilio/sms`
   - Handle incoming messages
   - Process STOP, START, HELP keywords
   - Update opt-in status accordingly

## Compliance Checklist

- ✅ Clear opt-in consent with checkbox
- ✅ Terms of Service and Privacy Policy
- ✅ Consent logging (timestamp, IP, method)
- ✅ Opt-out mechanism (STOP keyword support)
- ✅ Help support (HELP keyword)
- ✅ Message frequency disclosure (2-6/month)
- ✅ Message & data rates disclosure
- ✅ No third-party lists
- ✅ No prohibited content (SHAFT, lending, age-gated)
- ⚠️  Twilio webhook integration (pending)
- ⚠️  Confirmation SMS sending (pending)

## Sample Messages

### Opt-In Confirmation
```
[Enclave/Entrenched Coils] You're opted in for updates and reminders. Up to 6 msgs/mo. Msg&Data rates may apply. Reply HELP for help, STOP to opt out.
```

### Event Reminder
```
[Enclave] Reminder: SEP officer sync today 6:00pm in Boelter 5249. Agenda: https://tryenclave.com/sep-agenda. Reply YES to confirm, HELP for help, STOP to opt out. Msg&Data rates may apply.
```

### Task Nudge
```
[Entrenched Coils] You asked me to remind you: Email Sarah the budget by 5pm. Reply DONE when sent. HELP for help, STOP to opt out. Msg&Data rates may apply.
```

### Opt-Out Confirmation
```
[Enclave/Entrenched Coils] You have been unsubscribed. You will no longer receive messages from us. Reply START to resubscribe.
```

### Help Response
```
[Enclave/Entrenched Coils] Help: Text STOP to opt out, START to opt back in. Up to 6 msgs/mo. Msg&Data rates may apply. Support: support@tryenclave.com
```

## Testing

1. Visit `http://localhost:3000/sms-optin` in development
2. Fill out the form with a test phone number
3. Check the `sms_optin` table in Supabase
4. Verify consent information is logged correctly

## Production Deployment

The feature has been deployed to Vercel. Access the pages at:
- https://tryenclave.com/terms
- https://tryenclave.com/sms-optin

Make sure to:
1. Run the database migration on your production Supabase instance
2. Configure Twilio credentials in Vercel environment variables
3. Set up Twilio webhook URL for incoming messages
4. Test opt-in and opt-out flows

## Support

For questions or issues, contact support@tryenclave.com




