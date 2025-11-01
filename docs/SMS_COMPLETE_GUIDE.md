# SMS Bot Complete Guide

Complete guide to the SMS bot functionality including setup, architecture, usage, and capabilities.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Setup & Configuration](#setup--configuration)
4. [Capabilities](#capabilities)
5. [System Flow](#system-flow)
6. [Troubleshooting](#troubleshooting)
7. [Reference](#reference)

---

## Quick Start

### For Users
1. **Opt in**: Visit `https://tryenclave.com/sms-optin` or text `START` to the bot number
2. **Ask questions**: Text any question about events, policies, or resources
3. **Make announcements**: Text "I wanna make an announcement" to send messages
4. **Create polls**: Text "I wanna make a poll" to ask questions

### For Developers
1. Set up Twilio credentials in environment variables
2. Configure database tables (see Database Setup)
3. Deploy webhook URL to Twilio console
4. Test with `START` keyword

---

## Architecture

**See**: [SMS_SYSTEM_SUMMARY.md](./SMS_SYSTEM_SUMMARY.md) for full architectural details.

### Key Components
- **Webhook Handler**: `/api/twilio/sms/route.ts` - Main entry point
- **Conversational Context**: LLM-based intent classification
- **Query Planner**: Routes queries to appropriate tools (knowledge graph, docs, announcements)
- **Hybrid Search**: Cross-workspace semantic + keyword search
- **Action Handlers**: Polls, announcements, drafts

### Priority Routing
Messages flow through 8 priority levels:
1. Name detection
2. Send commands (SEND IT, SEND NOW)
3. Poll responses
4. Poll question input
5. Query detection
6. Draft editing
7. Tone modifications
8. Query processing

---

## Setup & Configuration

### Prerequisites
- Twilio account with approved campaign
- Supabase database
- Vercel deployment (or similar hosting)

### Environment Variables

```bash
# Twilio
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

# Supabase (should already exist)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Mistral AI
MISTRAL_API_KEY=your_mistral_api_key

# Airtable (optional, for poll results)
AIRTABLE_API_KEY=your_airtable_api_key
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TABLE_NAME=RSVP Responses
AIRTABLE_PUBLIC_RESULTS_URL=https://airtable.com/...
```

### Database Setup

Run these SQL files in Supabase SQL Editor:

1. **SMS Opt-in Schema** (`database/sms-optin-schema.sql`):
   - Creates `sms_optin` table
   - Creates `sms_message_log` table
   - Sets up opt-out handler function

2. **SMS Query Session Schema** (`database/sms-query-session-schema.sql`):
   - Creates `sms_query_session` table for tracking active queries

3. **SMS Conversation History** (`database/sms-conversation-history-schema.sql`):
   - Creates `sms_conversation_history` for context

4. **Poll Tables** (`database/polls-schema.sql`):
   - `sms_poll_drafts`
   - `sms_poll`
   - `sms_poll_response`

5. **Announcement Tables** (`database/announcements-schema.sql`):
   - `sms_announcement_drafts`
   - `sms_announcements`

### Twilio Webhook Configuration

1. Go to Twilio Console → Phone Numbers → Manage
2. Click your phone number
3. Under "Messaging Configuration":
   - **Webhook URL**: `https://tryenclave.com/api/twilio/sms`
   - **HTTP Method**: `POST`
4. Click Save

---

## Capabilities

### 1. Query/Question Answering

Users can ask questions about:
- Events ("when is active meeting?", "what's happening this week?")
- Policies ("what is big little?", "how does attendance work?")
- People ("who is sarah?", "tell me about john")
- General information ("what's in the docs?")

**Features**:
- Cross-workspace search
- Temporal awareness (recognizes past/future events)
- AI-powered summarization
- Conversation context

### 2. Announcements

**Creating**:
- Text "I wanna make an announcement"
- Bot asks for content
- Preview draft before sending
- Edit with "make it meaner/nicer" or exact text

**Sending**:
- Text "send it" to broadcast
- Goes to all opted-in members
- Delivery tracking via Twilio status callbacks

### 3. Polls

**Creating**:
- Text "I wanna make a poll"
- Bot asks for question
- Default options: Yes, No, Maybe
- Preview before sending

**Responses**:
- Users respond with yes/no/option/code
- Real-time tracking
- Export to Airtable (optional)

### 4. Other Commands

- `STOP` - Opt out of SMS
- `START` - Opt in to SMS
- `HELP` - Get help message
- `SEP` - Legacy, still supported (auto-starts query session)

---

## System Flow

### Incoming Message Flow

```
Twilio Webhook
├─ Validate signature
├─ Normalize phone number
├─ Check opt-in status
├─ Load conversation history (last 3)
├─ Classify conversational context (LLM)
├─ Route through priority handlers:
│  ├─ Send command → Send draft
│  ├─ Poll response → Record response
│  ├─ Query → Search + answer
│  ├─ Draft editing → Update draft
│  └─ Onboarding → Name collection
└─ Return TwiML response
```

### Query Processing Flow

```
Query detected
├─ Early classification (abuse, smalltalk, enclave)
├─ Cross-workspace hybrid search
│  ├─ FTS (keyword search)
│  ├─ Vector search (semantic)
│  └─ Reranking
├─ Planner-based flow (if enabled)
│  ├─ LLM query planning
│  ├─ Execute tools (knowledge graph or doc search)
│  ├─ Compose response
│  └─ AI summarization
└─ Format + split for SMS
```

### Announcement Flow

```
"I wanna make an announcement"
├─ Extract details via LLM
├─ If no content → Ask "what would you like the announcement to say?"
├─ User provides content
├─ Extract text (handle quotes, corrections)
├─ Generate draft via LLM
├─ Save to database
└─ Preview + send confirmation

User: "send it"
├─ Load draft
├─ Send via Twilio to all opted-in members
├─ Log delivery status
└─ Confirm with sent count
```

---

## Troubleshooting

### Bot Not Responding

1. **Check webhook**: Verify URL is correct in Twilio console
2. **Check environment**: Ensure all credentials are set
3. **Check logs**: Look for errors in Vercel logs
4. **Signature validation**: Ensure `TWILIO_AUTH_TOKEN` is correct

### Wrong Responses

1. **Context classification**: Check `[Conversational Context]` logs
2. **Query misclassification**: Look for "Announcement input check" logs
3. **Temporal issues**: Verify AI prompt includes current date

### Poll/Announcement Issues

1. **Draft not found**: Check database for `sms_poll_drafts` and `sms_announcement_drafts`
2. **Not sending**: Verify Twilio credentials and phone number
3. **Airtable errors**: Check `UNKNOWN_FIELD_NAME` logs (retry with minimal record)

### Performance

1. **Slow responses**: Check embedding generation latency
2. **Timeout**: Increase Vercel function timeout (default 10s)
3. **Too many searches**: Consider caching frequently asked queries

---

## Reference

### Key Log Patterns

```
[Twilio SMS] Conversational context: {type} (confidence: {conf})
[Twilio SMS] Announcement input check: ...
[Twilio SMS] Using planner-based flow
[Twilio SMS] Knowledge graph failed, using cross-workspace doc search
[Twilio SMS] ✓ Found answer in "{title}" chunk {n}/{total}
```

### API Endpoints

- `POST /api/twilio/sms` - Main webhook handler
- `GET/POST /api/twilio/optin` - Manual opt-in
- `GET /api/twilio/sms/conversations` - Admin: list conversations
- `GET /api/twilio/sms/conversations/[phone]` - Admin: view thread

### Database Tables

**Opt-in & Users**:
- `sms_optin` - User consent and info
- `sms_message_log` - All sent messages
- `sms_conversation_history` - Message history

**Drafts & Actions**:
- `sms_announcement_drafts` - Pending announcements
- `sms_poll_drafts` - Pending polls
- `sms_announcements` - Sent announcements
- `sms_poll` - Sent polls
- `sms_poll_response` - User poll responses

**Sessions**:
- `sms_query_session` - Active query sessions

### Configuration Files

- `src/app/api/twilio/sms/route.ts` - Main webhook handler
- `src/lib/nlp/conversationalContext.ts` - Context classification
- `src/lib/planner.ts` - Query planning
- `src/lib/announcements.ts` - Announcement logic
- `src/lib/polls.ts` - Poll logic

---

## Advanced

### Custom Workspaces

Currently hardcoded to SEP workspaces. To change:
1. Update `getWorkspaceIds()` in route.ts
2. Replace `.ilike('name', '%SEP%')` with your criteria

### Tone Modifications

Bot automatically adjusts tone based on user input:
- Abusive language → Boundary message
- Smalltalk → Sassy redirects
- Requests → Professional responses

### Temporal Awareness

AI prompt includes current date/time for:
- Past queries ("when WAS active meeting")
- Recurring events ("every Wednesday" → check if today)
- Relative dates ("tonight", "tomorrow")

---

For detailed architectural information, see [SMS_SYSTEM_SUMMARY.md](./SMS_SYSTEM_SUMMARY.md).

