# SMS Bot System Architecture Summary

## Overview

The SMS bot (`src/app/api/twilio/sms/route.ts`) is a **context-aware conversational AI assistant** that routes incoming SMS messages through multiple priority handlers to support diverse workflows: queries, announcements, polls, and commands.

## Core Philosophy

**Multi-Path Routing with Fallbacks**: Messages flow through prioritized handlers, each checking specific conditions. The system uses LLM-based classification combined with rule-based safety checks to determine intent and route appropriately.

---

## System Flow

### 1. **Entry Point & Validation** (Lines 251-346)
```
POST /api/twilio/sms
├─ Validate Twilio signature
├─ Parse phone number (normalize to 10-digit)
├─ Check opt-in status (auto-opt-in if new user)
└─ Detect commands (STOP, START, HELP, SEP)
```

**Key Features**:
- **Auto-opt-in**: New users are automatically opted in (removed manual SEP requirement)
- **Name detection**: LLM-based detection of name declarations ("I'm Saathvik")
- **Bot identity**: Handles "is this Jarvis" questions with factual answers

---

### 2. **Context Classification** (Lines 532-600)
```
Load conversation history (last 3 messages)
├─ LLM-based conversational context classification
│  ├─ Types: announcement_input, poll_input, poll_response, poll_draft_edit, 
│  │         announcement_draft_edit, general_query, chat
│  └─ Confidence scoring (0.0-1.0)
├─ Get active drafts (announcement & poll)
└─ Derive context flags (isPollDraftContext, isAnnouncementDraftContext, etc.)
```

**Classification System**:
- **Primary**: Mistral-based LLM classifier (`classifyConversationalContext`)
- **Fallback**: Pattern matching on last bot message
  - If bot asked "what would you like the announcement to say?" → `announcement_input`
  - If bot asked "what would you like to ask in the poll?" → `poll_input`
- **Safety overrides**: Questions (containing "?") are NEVER treated as input

---

### 3. **Priority Routing System**

Messages flow through handlers in **strict priority order**:

#### **PRIORITY -1**: Conversational Context Classification (Lines 608-623)
- High-confidence (≥0.7) contexts skip query detection
- **Issue**: This is currently just logging, doesn't actually skip anything
- **Impact**: Classified contexts still fall through to query handlers

#### **PRIORITY 0**: Send Commands (Lines 625-666)
- `SEND IT`, `SEND NOW`, or send affirmations
- Sends the most recent draft (poll or announcement)
- **NOT triggered** if user is responding to a poll

#### **PRIORITY 1**: Poll Response (Lines 693-758)
- User responds to a poll with yes/no/option/code
- Strict validation (`isLikelyPollAnswer`) prevents abuse/toxicity from being treated as responses
- Records response to database + Airtable

#### **PRIORITY 2**: Poll Question Input (Lines 800-832)
- Bot asked "what would you like to ask in the poll?"
- User provides question content
- Generates conversational poll question via LLM

#### **PRIORITY 3**: Query Detection (Lines 835-882)
- Checks if message looks like a query (`looksLikeQuery` pattern matching)
- Queries are answered FIRST, then drafts are mentioned
- Prevents queries from being treated as draft edits

#### **PRIORITY 4**: Draft Editing (Lines 884-1077)

**Poll Draft Editing**:
- In `poll_draft_edit` context
- Handles corrections ("no it should say X", "make it meaner")
- Regenerates or replaces content based on intent

**Announcement Content Input** (NEW DRAFT):
- In `announcement_input` context AND no active draft
- Bot asked "what would you like the announcement to say?"
- Creates new draft with user content

**Announcement Draft Editing** (EXISTING DRAFT):
- In `announcement_draft_edit` context AND active draft
- Handles corrections and tone modifications

**Announcement Request**:
- User says "I wanna make an announcement"
- Extracts details via LLM, prompts for content if needed

#### **PRIORITY 5**: Tone Modifications (Lines 1128-1195)
- "make it meaner", "be nicer", etc.
- Regenerates draft with new tone

#### **PRIORITY 6**: Draft Deletion (Lines 1197-1259)
- "delete", "remove", "cancel" → deletes draft
- Handles ambiguous cases (if both drafts exist, determines which to delete)

#### **PRIORITY 7**: New User Onboarding (Lines 1396-1522)
- Checks if user needs to provide name (`needs_name` flag)
- Validates name declarations
- Sends welcome messages

#### **PRIORITY 8**: Query Processing (Lines 1523-2133)

**Early Classification Short-Circuit**:
- Abuse detection → boundary message
- Smalltalk → sassy redirects
- Enclave help → concise factual answers
- Profanity handling → tone engine applies policy

**Query Processing**:
- Searches across all SEP workspaces (cross-workspace hybrid search)
- Two flows: **PLANNER-BASED** (primary) or **OLD FLOW** (fallback)

**PLANNER-BASED FLOW** (Lines 1719-1907):
1. LLM-based query planning (`planQuery`) → determines intent & tools
2. Execute plan → try knowledge graph first
3. Fallback to doc search if knowledge graph fails
4. Compose response from tool results
5. AI summarization (chunks long documents)
6. Add draft follow-ups

**OLD FLOW** (Lines 1909-2133):
1. Direct hybrid search
2. Document chunking (1500 chars, 200 overlap)
3. AI summarization per chunk
4. Manual query classification + response formatting

---

## Key Subsystems

### 1. **Conversational Context Classification** (`src/lib/nlp/conversationalContext.ts`)
- **Purpose**: Determine what the user is doing in the conversation
- **Input**: Current message, last bot message, conversation history
- **Output**: Context type + confidence
- **Key Feature**: Pattern matching on last bot message as fallback

### 2. **Query Planning** (`src/lib/planner.ts`)
- **Purpose**: Intelligently route queries to the right tools
- **LLM-based**: Uses Mistral to classify intent and recommend tools
- **Fallback**: Rule-based plan if LLM confidence < 0.7
- **Tools**: `search_docs`, `search_announcements`, `search_knowledge`, `calendar_find`

### 3. **Hybrid Search** (`src/lib/search.ts`)
- **Components**: FTS (keyword), Vector (semantic), Reranker
- **Cross-workspace**: Searches all SEP workspaces in parallel
- **Blocked titles**: Filters out unwanted documents (e.g., "fu's")

### 4. **AI Summarization** (`src/app/api/ai/route.ts`)
- **Purpose**: Extract relevant answers from documents
- **Temporal awareness**: Compares document dates to current date
- **Chunking**: For long documents, tries multiple chunks
- **Prefix removal**: Strips "TL;DR:", "Quick answer:", etc.

### 5. **Tone Engine** (`src/lib/tone/engine.ts`)
- **Purpose**: Dynamically adjust bot tone based on input
- **Policies**: boundary, deflect, respond
- **Toxicity handling**: Profanity → boundary message

### 6. **Early Classification** (`src/lib/nlp/earlyClassify.ts`)
- **Purpose**: Fast short-circuit for common intents
- **Detects**: Smalltalk, abuse, Enclave Q&A, poll answers, more requests, feedback

---

## Data Flow

### Incoming Message
```
Twilio Webhook
├─ Validate signature
├─ Normalize phone number
├─ Load conversation history (last 3)
├─ Classify conversational context (LLM)
├─ Get active drafts
└─ Route through priorities
```

### Handler Selection
```
IF send command → PRIORITY 0
ELSE IF poll response → PRIORITY 1
ELSE IF poll question input → PRIORITY 2
ELSE IF looks like query → Answer query + mention drafts
ELSE IF draft editing context → Edit draft
ELSE IF tone modification → Regenerate with tone
ELSE IF deletion → Delete draft
ELSE IF new user needs name → Onboard
ELSE → Process as query
```

### Query Processing
```
Query detected
├─ Early classification (abuse, smalltalk, enclave)
├─ Cross-workspace hybrid search
├─ Planner-based flow (if enabled)
│  ├─ LLM query planning
│  ├─ Execute tools (knowledge graph or doc search)
│  ├─ Compose response
│  └─ AI summarization (chunking)
└─ Return formatted response
```

---

## Current Issues

### 1. **Conversational Context Classification**
- **Issue**: "High-confidence announcement context, skipping query detection" logs but doesn't actually skip
- **Impact**: Announced contexts still trigger query processing
- **Location**: Lines 608-623

### 2. **Announcement Input Not Triggering**
- **Issue**: When bot asks "what would you like the announcement to say?" and user responds with content, handler may not run
- **Debug logs added**: Lines 570, 1023
- **Likely cause**: One of the conditions (isAnnouncementDraftContext, activeDraft, looksLikeQuery, etc.) is blocking

### 3. **Temporal Awareness**
- **Issue**: Returns outdated "tonight" references from documents when current date doesn't match
- **Fix applied**: Enhanced AI prompt with explicit temporal rules
- **Testing**: Needs validation

### 4. **Query Misclassification**
- **Issue**: "What's happening?" sometimes classified as `announcement_input`
- **Fix applied**: Safety checks + improved LLM prompt
- **Testing**: Needs validation

---

## Improvement Opportunities

### 1. **Simplify Handler Priority Logic**
- Current system has 8+ priority levels with complex conditionals
- **Suggestion**: Extract handlers into separate modules with clear decision trees
- Use a finite state machine for conversation flows

### 2. **Fix "Skip Query Detection" Bug**
- Currently logging only; should actually short-circuit
- Move context-based routing earlier in the flow

### 3. **Better Error Handling**
- Catch and log handler failures
- Graceful degradation to simpler responses

### 4. **Testing**
- Add unit tests for each handler
- Integration tests for full conversation flows
- Temporal awareness validation tests

### 5. **Observability**
- Add metrics: handler hit rates, LLM latencies, success rates
- Track which paths messages take through the system

### 6. **Generalization**
- Currently SEP-specific (hardcoded workspace filtering)
- **Suggestion**: Make workspace selection dynamic based on user context
- Extract announcement/poll flows to reusable modules

---

## Configuration

### Feature Flags
- `USE_PLANNER` (line 49): Enables planner-based query flow

### Environment Variables
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `MISTRAL_API_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`

---

## Database Tables

### Core Tables
- `sms_optin`: User opt-in status, name, needs_name flag
- `sms_conversation_history`: Message history (last 3 used for context)
- `sms_query_session`: Active query sessions

### Draft Tables
- `sms_announcement_drafts`: Announcement drafts
- `sms_poll_drafts`: Poll drafts

### Poll Tables
- `sms_poll`: Sent polls
- `sms_poll_response`: User responses to polls

### External
- Airtable: Poll results export

---

## Key Concepts

### **Context-Based Routing**
The system uses conversational context (not just the current message) to route appropriately. If the bot just asked "what would you like the announcement to say?", the next message is almost certainly announcement input.

### **Multi-Layer Fallbacks**
Everything has a fallback:
- LLM classification → Pattern matching
- Planner-based flow → Old search flow
- AI summarization → Raw document body
- Knowledge graph → Doc search

### **Strict Priority Order**
Handlers must be checked in order because conditions overlap. For example, `looksLikeQuery` must be checked before draft editing to prevent queries from being treated as edits.

### **Cross-Workspace Search**
Searches across all SEP workspaces in parallel, deduplicates results, returns top 3.

### **Document Chunking**
Long documents are split into 1500-char chunks with 200-char overlap to ensure answers aren't missed due to token limits.

---

## End-to-End Example: Making an Announcement

```
User: "i wanna make an announcement"
├─ Conversational context: general_query (0.9)
├─ isAnnouncementRequest() → true
├─ Handler: Announcement Request (PRIORITY 4)
├─ Extract details → no content
└─ Response: "what would you like the announcement to say?"

User: "That Quinn is bad at football"
├─ Conversational context: announcement_input (0.9)
├─ lastBotMessage contains "what would you like the announcement to say?" → true
├─ isAnnouncementDraftContext → true (after fallback check)
├─ Handler: Announcement Content Input (PRIORITY 4)
├─ extractRawAnnouncementText() → "That Quinn is bad at football"
├─ generateAnnouncementDraft() → "Quinn is bad at football"
├─ saveDraft()
└─ Response: "okay here's what the announcement will say:\n\nQuinn is bad at football\n\nreply 'send it' to broadcast"

User: "send it"
├─ Command detection: SEND IT
├─ Handler: Send Command (PRIORITY 0)
├─ sendAnnouncement()
└─ Response: "sent to 45 people 📢"
```

---

## Debugging

### Key Log Patterns
- `[Twilio SMS] Conversational context: {type} (confidence: {conf})`
- `[Twilio SMS] Announcement input check: ...`
- `[Twilio SMS] Using planner-based flow`
- `[Twilio SMS] Knowledge graph failed, using cross-workspace doc search`
- `[Twilio SMS] ✓ Found answer in "{title}" chunk {n}/{total}`

### Common Issues
1. **Handler not triggering**: Check all conditions in console.log
2. **Wrong classification**: Check last bot message and conversation history
3. **Temporal issues**: Validate AI prompt includes current date
4. **Missing results**: Check workspace filtering, blocked titles

---

## Next Steps for Generalization

1. **Extract Handler Modules**: Separate announcement, poll, query into own modules
2. **State Machine**: Model conversation flows as FSM
3. **Dynamic Workspace**: Load user's workspace(s) dynamically
4. **Plugin System**: Make handlers pluggable/configurable
5. **Testing Infrastructure**: Add comprehensive test coverage
6. **Observability**: Add metrics and tracing



