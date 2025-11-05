# Enclave Complete Functionality Documentation

**Last Updated**: November 2025  
**Version**: 1.1 (Orchestrator-First Architecture)

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Orchestrator Architecture](#orchestrator-architecture)
3. [SMS Bot Capabilities](#sms-bot-capabilities)
4. [Scopes & Retrievers](#scopes--retrievers)
5. [Data Models](#data-models)
6. [API Endpoints](#api-endpoints)
7. [Conversation Flows](#conversation-flows)
8. [Configuration](#configuration)
9. [Deployment](#deployment)

---

## System Overview

Enclave is a **multi-modal organizational AI assistant platform** that unifies communications and knowledge across SMS, Slack, Google Calendar, Docs, and other integrations into a searchable, interactive interface.

### Core Components

1. **Orchestrator** (`src/lib/orchestrator/`): Central decision-making system that determines which scopes to use and how to compose responses
2. **SMS Bot** (`src/app/api/twilio/sms/route.ts`): Main webhook handler for SMS interactions
3. **Hybrid Search** (`src/lib/search.ts`): BM25 + Vector + Reranker retrieval system
4. **Planner** (`src/lib/planner.ts`): LLM-based query planning and tool execution
5. **Action State** (`src/lib/orchestrator/actionState.ts`): Live system state (drafts, polls, actions)

### Key Principles

- **Context-First**: Every decision uses conversation history and system state
- **Deterministic Routing**: Rule-based short-circuits before LLM classification
- **Multi-Scope Evidence**: Answers composed from multiple information sources
- **Quote-Preserving**: User-quoted text is used verbatim in drafts
- **State Coherence**: Draft state drives routing, not just classification

---

## Orchestrator Architecture

The orchestrator is the **meta-supervisor** that decides which information scopes to open and how to combine evidence into responses.

### Core Flow

```
Incoming Message
  ↓
1. Load Conversation Snapshot (last ~10 messages)
  ↓
2. Classify Intent (deterministic + LLM)
  ↓
3. Pre-select Scopes (based on intent)
  ↓
4. Retrieve Evidence (from each selected scope)
  ↓
5. Select Relevant Scopes (based on evidence quality)
  ↓
6. Compose ContextEnvelope (ordered evidence)
  ↓
7. Decide ResponseMode (Answer, DraftProposal, etc.)
  ↓
8. Generate Response
```

### Intent Classification

**Types**:
- `small_talk`: Greetings, thank you, casual chat
- `info_query`: Questions about org content ("when is active meeting")
- `encl_query`: Questions about Enclave itself
- `draft_create`: Creating new announcement/poll
- `draft_edit`: Editing existing draft
- `send_action`: Sending a draft ("send it")
- `state_query`: Asking about drafts/actions ("what is the draft")
- `mixed`: Multiple intents in one message

**Classification Logic**:
1. **Action Router** (deterministic): Checks for imperative verbs, patterns
2. **LLM Classifier** (fallback): Mistral-based intent classification
3. **Context Checks**: Conversation history, active drafts, pending polls

### Scope Budgets

Each intent has a `k` limit (max items) per scope:

| Intent | RESOURCE | ACTION | ENCLAVE | CONVO | SMALLTALK |
|--------|----------|--------|---------|-------|-----------|
| `small_talk` | 0 | 0 | 0 | 5 | 0 |
| `info_query` | 10 | 0 | 0 | 5 | 0 |
| `encl_query` | 5 | 0 | 8 | 3 | 0 |
| `draft_create` | 8 | 5 | 3 | 5 | 0 |
| `draft_edit` | 5 | 1 | 0 | 10 | 0 |
| `send_action` | 0 | 1 | 0 | 3 | 0 |
| `state_query` | 0 | 10 | 0 | 3 | 0 |
| `mixed` | 8 | 5 | 5 | 5 | 0 |

**No token limits** - context determines what's needed.

### Response Modes

- **Answer**: Information query response with citations
- **DraftProposal**: Proposed draft for user approval
- **DraftEdit**: Edited draft based on user instructions
- **ActionConfirm**: Confirmation prompt before executing action
- **ActionExecute**: Execute action (send announcement/poll)
- **ChitChat**: Short, casual response for smalltalk

---

## SMS Bot Capabilities

### 1. Queries & Information Retrieval

**What it does**: Answers questions about organizational content (events, policies, people, documents)

**How it works**:
1. **Early Classification**: Short-circuits abuse, smalltalk, Enclave Q&A
2. **Hybrid Search**: Searches across all SEP workspaces (FTS + Vector + Reranker)
3. **Planner-Based Flow** (primary):
   - LLM query planning → determines intent & tools
   - Execute tools (knowledge graph or doc search)
   - Compose response from results
   - AI summarization with temporal awareness
4. **Old Flow** (fallback): Direct hybrid search → chunking → AI summarization

**Sources**:
- Google Docs (chunked documents)
- Uploaded resources
- Calendar events
- Slack messages
- Airtable data

**Temporal Awareness**:
- Compares document dates to current date
- Converts relative dates ("tonight", "tomorrow") to absolute dates
- Handles past/future/recurring events correctly

**Example**:
```
User: "when is active meeting"
Bot: "Active Meetings occur every Wednesday at 8:00 PM. They're usually held at Mahi's apartment (461B Kelton) or Ash's apartment (610 Levering)."
```

### 2. Announcements

**What it does**: Create, edit, and send bulk SMS announcements

**Workflow**:
1. **Create**: User says "I wanna make an announcement" → Bot asks for content
2. **Input**: User provides content → Bot creates draft
3. **Edit**: User says "make it say X" or "change it to Y" → Bot updates draft
4. **Send**: User says "send it" → Bot broadcasts to all/members

**Features**:
- **Quote-Preserving**: Text in quotes is used verbatim
- **Intelligent Patching**: Edits preserve existing content (e.g., "make it say it's at 9pm" adds time, doesn't replace whole message)
- **Tone Modifications**: "make it meaner", "be nicer", "more hype"
- **Exact Text Requests**: "no it should say X" uses exact wording
- **Draft Queries**: "what is the draft" returns current draft content

**Draft Lifecycle**:
- `drafting` → `ready` → `sent` / `discarded`
- Only one active draft per user per type (enforced by partial unique index)
- Background manager surfaces pending drafts after unrelated queries

**Example**:
```
User: "send out an announcement telling people to come to bcaf rn"
Bot: "okay here's what the announcement will say:
     hey team, bcaf meeting is mandatory asap. don't miss it! details to follow. thx!
     reply 'send it' to broadcast or reply to edit the message"

User: "Make it say it's at 9pm"
Bot: "updated:
     hey team, bcaf meeting is mandatory asap. don't miss it! details to follow. thx! at 9pm
     reply 'send it' to broadcast"

User: "send it"
Bot: "sent to 45 people 📢"
```

### 3. Polls

**What it does**: Create, send, and collect responses for SMS polls

**Workflow**:
1. **Create**: User says "make a poll asking X" → Bot asks for question
2. **Input**: User provides question → Bot creates draft
3. **Edit**: User edits question/options
4. **Send**: User says "send it" → Bot sends to recipients
5. **Response**: Recipients reply with yes/no/option/code → Bot records response

**Features**:
- **Multiple Choice**: Custom options (e.g., "Yes", "No", "Maybe")
- **Free Response**: Can capture notes ("yes, 5 mins late" → response="Yes", note="5 mins late")
- **Poll Codes**: Short codes for easy identification
- **Airtable Export**: Results automatically exported to Airtable
- **Response Tracking**: Tracks who responded and when

**Example**:
```
User: "make a poll asking if people are coming to active meeting"
Bot: "okay here's what the poll will say:
     are you coming to active meeting?
     reply 'send it' to send"

User: "send it"
Bot: "sent poll to 48 people 📊
     view results: [Airtable link]"

[Later, user responds]
User: "yes"
Bot: "got it — recorded: Yes"
```

### 4. Smalltalk & Chat

**What it does**: Handles casual conversation, greetings, and off-topic messages

**Features**:
- **Deterministic Detection**: Pattern matching for "thank you", "hi", "ok", etc.
- **Short Responses**: Polite, concise replies (no document search)
- **Draft Mentions**: Mentions pending drafts if they exist
- **Sassy Tone**: For profanity/non-abusive smalltalk

**Example**:
```
User: "thank you"
Bot: "you're welcome! 😊
     btw you have an announcement draft ready - reply 'send it' to send"
```

### 5. Early Classification & Guardrails

**What it does**: Fast short-circuit for common intents before expensive operations

**Categories**:
- **Abuse**: Profanity, insults → boundary message
- **Smalltalk**: Greetings, thank you → short response
- **Enclave Q&A**: Questions about Enclave → concise factual answers
- **Poll Answers**: yes/no/maybe → route to poll response handler
- **More Requests**: "more" → expand last answer
- **Feedback**: "this doesn't make sense" → clarification prompt

**Implementation**: `src/lib/nlp/earlyClassify.ts`

### 6. Name Detection & Onboarding

**What it does**: Detects when users declare their name and handles first-time users

**Features**:
- **LLM-Based Detection**: Identifies name declarations ("I'm Saathvik", "my name is John")
- **Auto-Opt-In**: New users automatically opted in
- **Welcome Messages**: Sassy, personalized welcome for new users
- **Name Storage**: Saves name to `sms_optin` table

---

## Scopes & Retrievers

### Scope: CONVO (Conversation Snapshot)

**Purpose**: Last ~10 messages, entities, unresolved intents, tone

**Retriever**: `src/lib/orchestrator/convoSnapshot.ts`

**Returns**:
- Conversation context (user + bot messages)
- Extracted entities (quoted text, times, dates)
- Unresolved intent detection
- Tone profile

**Use Cases**:
- Understanding follow-up queries
- Detecting correction patterns
- Extracting quoted text for drafts

### Scope: RESOURCE (Org Knowledge / SEP Layer)

**Purpose**: RAG over docs, Slack, Drive, calendar

**Retriever**: `src/lib/search.ts` (hybrid search)

**Components**:
- **FTS (Full-Text Search)**: Keyword matching via Postgres
- **Vector Search**: Semantic similarity via embeddings
- **Reranker**: Cross-encoder for relevance scoring

**Features**:
- Cross-workspace search (all SEP workspaces in parallel)
- Blocked titles filter (removes unwanted documents)
- Hierarchical chunking (preserves document structure)
- Source-specialized retrievers (Google Docs, Calendar, Slack)

**Use Cases**:
- "when is active meeting"
- "what is big little"
- "who is sarah"

### Scope: ENCLAVE (Product Context)

**Purpose**: What Enclave is/does, commands, error FAQs, usage examples

**Retriever**: `src/lib/enclave/answers.ts`

**Source**: `docs/ENCLAVE_SYSTEM_REFERENCE.md`

**Features**:
- Factual knowledge base (no tone, slang, or stylistic responses)
- Technical architecture details
- Capabilities and features
- Error handling FAQs

**Use Cases**:
- "what is enclave"
- "who built enclave"
- "what can enclave do"

### Scope: ACTION (Action State)

**Purpose**: Live system state (pending drafts, sent announcements/polls, recent responses)

**Retriever**: `src/lib/orchestrator/actionState.ts`

**Returns**:
- **Pending Draft**: Current announcement or poll draft
- **Pending Poll**: Poll waiting for user response
- **Recent Actions**: Last 10 sent announcements/polls with metadata
- **Evidence Units**: Formatted evidence for orchestrator

**Features**:
- Zero LLM risk (direct DB/API reads)
- Structured data (not free-form text)
- Real-time state (no caching)

**Use Cases**:
- "what is the draft" → returns draft content
- Draft editing → retrieves current draft
- Send confirmation → checks draft exists

### Scope: SMALLTALK

**Purpose**: Lightweight one-liners, emojis, in-jokes

**Retriever**: Rule-based (no retrieval needed)

**Features**:
- Pattern matching for common phrases
- Short, polite responses
- Never triggers tools or expensive operations

**Use Cases**:
- "thank you" → "you're welcome! 😊"
- "hi" → "hey! what's up?"

---

## Data Models

### TurnContext

```typescript
interface TurnContext {
  user_id?: string
  org_id?: string
  phone_number: string
  last_messages: Array<{
    speaker: 'user' | 'bot'
    text: string
    ts: string
  }>
  pending_draft?: Draft
}
```

### EvidenceUnit

```typescript
interface EvidenceUnit {
  scope: 'CONVO' | 'RESOURCE' | 'ENCLAVE' | 'ACTION' | 'SMALLTALK'
  source_id: string
  text: string
  ts?: string
  acl_ok: boolean
  scores: {
    semantic: number
    keyword: number
    freshness: number
    role_match: number
  }
}
```

### ContextEnvelope

```typescript
interface ContextEnvelope {
  intent: Intent
  scopes: Scope[]
  evidence: EvidenceUnit[]
  system_state: {
    pending_draft?: Draft
    recent_actions?: Action[]
    pending_poll?: PollState
  }
}
```

### Draft

```typescript
interface Draft {
  id: string
  kind: 'announcement' | 'poll'
  title?: string
  body?: string  // for announcements
  question?: string  // for polls
  options?: string[]  // for polls
  audience: string[] | 'all'
  created_by: string
  last_edit_ts: string
  workspace_id?: string
}
```

### Database Tables

#### `sms_optin`
- `phone`: Primary key (10-digit normalized)
- `name`: User's name (optional)
- `opted_out`: Boolean
- `needs_name`: Boolean (prompt for name if true)
- `consent_timestamp`: When user opted in
- `updated_at`: Last activity

#### `sms_conversation_history`
- `phone_number`: Foreign key to `sms_optin.phone`
- `user_message`: User's message
- `bot_response`: Bot's response
- `created_at`: Timestamp

#### `sms_announcement_drafts`
- `id`: UUID primary key
- `phone`: Foreign key
- `content`: Draft body text
- `tone`: 'casual' | 'urgent' | 'neutral'
- `scheduled_for`: Optional timestamp
- `target_audience`: 'all' | specific audience
- `workspace_id`: UUID
- `created_at`, `updated_at`: Timestamps

**Constraints**: Partial unique index on `(phone)` where status IN ('drafting', 'ready') - ensures only one active draft per phone

#### `sms_poll_drafts`
- `id`: UUID primary key
- `phone`: Foreign key
- `question`: Poll question text
- `options`: Array of strings (default: ['Yes', 'No', 'Maybe'])
- `workspace_id`: UUID
- `created_at`, `updated_at`: Timestamps

**Constraints**: Partial unique index on `(phone)` where status IN ('drafting', 'ready')

#### `sms_poll`
- `id`: UUID primary key
- `question`: Poll question
- `options`: Array of strings
- `code`: Short code for identification
- `created_at`, `sent_at`: Timestamps

#### `sms_poll_response`
- `poll_id`: Foreign key to `sms_poll`
- `phone`: Foreign key to `sms_optin`
- `response`: User's response text
- `note`: Optional free-form note
- `response_status`: 'pending' | 'completed'
- `responded_at`: Timestamp
- Primary key: `(poll_id, phone)`

#### `announcement`
- `id`: UUID primary key
- `creator_phone`: Foreign key
- `final_content`: Sent announcement text
- `draft_content`: Original draft (if different)
- `tone`: Tone used
- `target_audience`: Audience
- `status`: 'draft' | 'sent' | 'cancelled'
- `sent_at`: Timestamp
- `created_at`: Timestamp

#### `sms_message_log`
- `phone`: Phone number
- `message`: Message text
- `status`: 'queued' | 'sent' | 'delivered' | 'failed'
- `twilio_sid`: Twilio message SID
- `sent_at`, `created_at`: Timestamps

---

## API Endpoints

### SMS Webhook

**Endpoint**: `POST /api/twilio/sms`

**Purpose**: Main entry point for all incoming SMS messages

**Flow**:
1. Validate Twilio signature
2. Normalize phone number
3. Check opt-in status (auto-opt-in if new)
4. Load conversation context
5. Route through orchestrator or legacy handlers
6. Generate and return TwiML response

**Response Format**: TwiML XML
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Response text here</Message>
</Response>
```

**Multiple Messages**: Supports splitting long messages into multiple `<Message>` tags

### Admin Conversations API

**Endpoint**: `GET /api/admin/sms/conversations`

**Purpose**: List all SMS conversations for admin dashboard

**Query Parameters**:
- `q`: Search query (phone number or name)
- `limit`: Max results (default: 50, max: 200)
- `offset`: Pagination offset

**Response**:
```json
{
  "total": 100,
  "items": [
    {
      "phone": "+13853687238",
      "name": "Saathvik",
      "optedOut": false,
      "latestActivityAt": "2025-11-04T18:25:00Z",
      "sentCount": 5,
      "failedCount": 0
    }
  ]
}
```

### Admin Conversation Thread API

**Endpoint**: `GET /api/admin/sms/conversations/[phone]`

**Purpose**: Get full conversation thread for a specific phone number

**Response**: Array of messages with timestamps

---

## Conversation Flows

### Flow 1: Information Query

```
User: "when is active meeting"
  ↓
Orchestrator:
  - Intent: info_query
  - Scopes: [RESOURCE, CONVO]
  - Retrieve: Hybrid search across SEP docs
  - Evidence: [Calendar event: "Active Meeting every Wednesday 8pm"]
  ↓
Response: "Active Meetings occur every Wednesday at 8:00 PM. They're usually held at Mahi's apartment (461B Kelton) or Ash's apartment (610 Levering)."
```

### Flow 2: Creating Announcement

```
User: "I wanna make an announcement"
  ↓
Orchestrator:
  - Intent: draft_create
  - Scopes: [ACTION, RESOURCE, CONVO]
  - Evidence: [No pending draft, recent announcements for context]
  ↓
Bot: "what would you like the announcement to say?"

User: "That Quinn is bad at football"
  ↓
Orchestrator:
  - Intent: draft_create (still)
  - Scopes: [ACTION, CONVO]
  - Evidence: [Last bot message asks for content, user provides content]
  - Mode: DraftProposal
  ↓
Bot: "okay here's what the announcement will say:
     Quinn is bad at football
     reply 'send it' to broadcast or reply to edit"

User: "send it"
  ↓
Orchestrator:
  - Intent: send_action
  - Scopes: [ACTION]
  - Evidence: [Pending draft exists]
  - Mode: ActionExecute
  ↓
Bot: "sent to 45 people 📢"
```

### Flow 3: Editing Draft

```
[Active draft exists: "hey team, bcaf meeting is mandatory asap"]

User: "Make it say it's at 9pm"
  ↓
Orchestrator:
  - Intent: draft_edit
  - Scopes: [ACTION, CONVO]
  - Evidence: [Pending draft, last user message with edit instruction]
  - Mode: DraftEdit
  ↓
Bot: "updated:
     hey team, bcaf meeting is mandatory asap. don't miss it! details to follow. thx! at 9pm
     reply 'send it' to broadcast"
```

### Flow 4: Copy What I Wrote

```
[User previously sent: "CREATATHON ‼️🚨 when: friday nov 14, 4-10pm"]

User: "that's the same thing can you copy what i wrote"
  ↓
Orchestrator:
  - Intent: draft_edit
  - Scopes: [ACTION, CONVO]
  - Evidence: [Pending draft, conversation history with previous message]
  - Mode: DraftEdit
  - Extract: Previous user message from conversation history
  ↓
Bot: "updated:
     CREATATHON ‼️🚨 when: friday nov 14, 4-10pm
     reply 'send it' to broadcast"
```

### Flow 5: Draft Query

```
[Active draft exists]

User: "what is the draft"
  ↓
Orchestrator:
  - Intent: state_query
  - Scopes: [ACTION]
  - Evidence: [Pending draft content]
  - Mode: Answer
  ↓
Bot: "here's what the announcement will say:
     [draft content]
     reply 'send it' to broadcast or reply to edit"
```

### Flow 6: Poll Response

```
[Poll sent: "Are you coming to active meeting? Reply YES or NO"]

User: "yes"
  ↓
Orchestrator:
  - Intent: (detected as poll_response by action router)
  - Scopes: [ACTION]
  - Evidence: [Pending poll waiting for response]
  - Mode: ActionExecute
  ↓
Bot: "got it — recorded: Yes"
[Response saved to database + Airtable]
```

### Flow 7: Smalltalk

```
User: "thank you"
  ↓
Orchestrator:
  - Intent: small_talk
  - Scopes: [SMALLTALK]
  - Mode: ChitChat
  ↓
Bot: "you're welcome! 😊
     btw you have an announcement draft ready - reply 'send it' to send"
```

---

## Configuration

### Environment Variables

**Twilio**:
- `TWILIO_ACCOUNT_SID`: Twilio account SID
- `TWILIO_AUTH_TOKEN`: Twilio auth token
- `TWILIO_PHONE_NUMBER`: Sender phone number

**AI/LLM**:
- `MISTRAL_API_KEY`: Mistral API key (for LLM classification and planning)
- `OPENAI_API_KEY`: OpenAI API key (for embeddings, if used)

**Database**:
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (for admin operations)

**Airtable**:
- `AIRTABLE_BASE_ID`: Airtable base ID
- `AIRTABLE_PERSONAL_ACCESS_TOKEN`: Airtable PAT

**Application**:
- `NEXT_PUBLIC_APP_URL`: Public URL (for AI API calls)
- `NODE_ENV`: Environment (development/production)

### Feature Flags

**In Code**:
- `USE_PLANNER` (line 49 in `route.ts`): Enable planner-based query flow

---

## Deployment

### Hosting

- **Frontend + APIs**: Vercel (Next.js serverless functions)
- **Database**: Supabase (Postgres + vector store)
- **Scheduler**: Background cron jobs (announcement-sender, alert-scheduler)
- **Monitoring**: Telemetry table + optional analytics dashboard

### Workers

**Background Jobs**:
- `alert-scheduler.ts`: Scheduled reminders and alerts
- `announcement-sender.ts`: Sends scheduled announcements
- `event-consolidator.ts`: Consolidates event data

### Database Setup

**Required Tables**:
- `sms_optin`
- `sms_conversation_history`
- `sms_announcement_drafts`
- `sms_poll_drafts`
- `sms_poll`
- `sms_poll_response`
- `announcement`
- `sms_message_log`

**Indexes**:
- Partial unique index on `sms_announcement_drafts(phone)` where status IN ('drafting', 'ready')
- Partial unique index on `sms_poll_drafts(phone)` where status IN ('drafting', 'ready')
- Index on `sms_conversation_history(phone_number, created_at)` for fast lookups

### Monitoring

**Telemetry**:
- All queries logged to `telemetry` table
- Request IDs for tracing
- Handler hit rates, LLM latencies, success rates

**Logs**:
- `[Twilio SMS]`: Main webhook handler logs
- `[Orchestrator]`: Orchestrator decision logs
- `[Planner]`: Query planning logs
- `[Conversational Context]`: Context classification logs

---

## Key Features & Behaviors

### Quote-Preserving Draft Synthesis

**How it works**:
1. Extract all quoted segments from user message
2. If quotes present:
   - Poll: First quote = question, remaining = options
   - Announcement: All quotes concatenated = verbatim body
3. If no quotes: Pass through LLM for clean synthesis

**Example**:
```
User: 'send a poll about "are you coming to active meeting"'
→ Draft question: "are you coming to active meeting"

User: 'announce: "bring cleats" "meet at 6:50"'
→ Draft body: "bring cleats meet at 6:50"
```

### Intelligent Draft Patching

**How it works**:
- Extracts time/date patterns from edit instructions
- Appends to existing content instead of replacing
- Preserves structure and tone

**Example**:
```
Current: "hey team, bcaf meeting is mandatory asap"
Edit: "Make it say it's at 9pm"
Result: "hey team, bcaf meeting is mandatory asap at 9pm"
```

### Deterministic Action Router

**How it works**:
- Runs BEFORE LLM classification
- Pattern matching for imperative verbs
- Routes to ACTION pipeline with high confidence
- Forces edit path when ACTION + active draft detected

**Patterns Detected**:
- `make`, `change`, `edit`, `update`, `send`
- `copy what i wrote`, `that's the same thing`
- `what is the draft` → DRAFT_QUERY intent

### Conversation History Tracking

**Purpose**: Ensure `lastBotMessage` is correctly set for context classification

**When Saved**:
- After bot asks "what would you like the announcement to say?"
- After bot asks "what would you like to ask in the poll?"
- After all bot responses (in new handlers)

**Format**: `sms_conversation_history` table with `phone_number`, `user_message`, `bot_response`, `created_at`

### Cross-Workspace Search

**How it works**:
1. Get all SEP workspaces (currently hardcoded to 4 workspaces)
2. Search each workspace in parallel
3. Deduplicate results by title
4. Return top 3 unique results

**Performance**: Parallel execution reduces latency

### Temporal Awareness

**How it works**:
1. AI prompt includes `Current date/time: ${new Date().toISOString()}`
2. Compares document dates to current date
3. Converts relative dates ("tonight", "tomorrow") to absolute dates
4. Humanizes time at response generation ("was yesterday", "is tomorrow", "is in 2 hours")

**Rules**:
- Past events: "was on Tuesday at 5pm"
- Today/tomorrow: "is today/tomorrow at ..."
- Future: "is in 3 days"

---

## Error Handling

### Airtable Errors

**Issue**: `UNKNOWN_FIELD_NAME` when upserting poll responses

**Fix**: Retry with minimal record (Person only) if dynamic field names fail

### Classification Failures

**Issue**: LLM misclassifies context

**Fixes**:
- Fallback pattern matching on last bot message
- Hard-coded short-circuits for high-confidence cases
- Safety overrides (questions never treated as input)

### Message Truncation

**Issue**: Long responses truncated by Twilio

**Fix**: `splitLongMessage()` splits at sentence boundaries into multiple `<Message>` tags

### Draft State Coherence

**Issue**: `activeDraft=true` but `isAnnouncementDraftContext=false`

**Fix**: Derive context from draft state + action router, not just classifier

---

## Testing & Debugging

### Key Log Patterns

**Orchestrator**:
```
[Orchestrator] Intent: draft_edit
[Orchestrator] Preselected scopes: ACTION, CONVO
[Orchestrator] Retrieved 2 evidence units
[Orchestrator] Selected scopes: ACTION, CONVO
[Orchestrator] Response mode: DraftEdit
```

**SMS Handler**:
```
[Twilio SMS] Conversational context: announcement_input (confidence: 0.9)
[Twilio SMS] Action router: intent=ACTION, confidence=0.95, operation=edit
[Twilio SMS] Editing announcement draft in context: "..." (forceEditPath=true)
```

**Query Processing**:
```
[Twilio SMS] Using planner-based flow
[Planner] Planning query: "..."
[Planner LLM] Classified as: event_lookup, confidence: 0.9
[Twilio SMS] ✓ Found answer in "Active meeting" chunk 1/3
```

### Common Issues

1. **Handler not triggering**: Check all conditions in console.log output
2. **Wrong classification**: Check last bot message and conversation history
3. **Missing conversations**: Verify phone number normalization matches saving format
4. **Temporal issues**: Validate AI prompt includes current date

---

## Future Enhancements

### Planned Features

1. **Resource Retriever**: Implement hybrid search for RESOURCE scope
2. **Enclave Retriever**: Implement product knowledge retrieval for ENCLAVE scope
3. **Response Generator**: LLM-based response generation from ContextEnvelope
4. **Metrics Dashboard**: Scope hit rates, evidence quality, response times
5. **Router Learner**: ML-based intent classification from features

### Generalization Path

1. **Intent Plugins**: Each handler exports `canHandle()` and `handle()`
2. **Config Layer**: Workspace, announcement channels, default poll options, tones
3. **Policy Pack**: Sassy/profanity responses, quote rules, send commands (JSON config)
4. **Schema Contracts**: Stable data models with adapters for Airtable/Sheets
5. **Prompt Library**: Versioned templates for classifier, drafting, retone

---

## Summary

Enclave's SMS bot is a **context-aware, orchestrator-driven conversational AI** that:

- **Routes intelligently** using deterministic action router + LLM classification
- **Retrieves from multiple scopes** (CONVO, RESOURCE, ENCLAVE, ACTION, SMALLTALK)
- **Preserves user intent** through quote-preserving draft synthesis
- **Handles state coherently** with draft lifecycle management
- **Answers accurately** with temporal awareness and citation-rich responses
- **Executes actions reliably** with confirmation gates and idempotence

The orchestrator-first architecture ensures that every decision uses the full context available, while maintaining deterministic safety checks for reliability.

