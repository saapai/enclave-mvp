# Enclave SMS Agent v1.1 Implementation Status

## ✅ Completed

### Quote-Preserving Draft Synthesis
- ✅ Created `src/lib/nlp/quotes.ts` utility
- ✅ Added `quotedSegments` to `ConversationalContext` type
- ✅ Enhanced LLM prompt to extract quoted text
- ✅ Updated `extractPollDetails` to use `parsePollQuotes`
- ✅ Updated `extractAnnouncementDetails` to use `parseAnnouncementQuotes`
- ✅ Supports multiple quotes: first quote → poll question, remaining → options
- ✅ Announcements: join all quotes with single space

### Conversational Context Classification  
- ✅ LLM-based context classifier with confidence scores
- ✅ Context types: `announcement_input`, `poll_input`, `poll_response`, `poll_draft_edit`, `announcement_draft_edit`, `general_query`, `chat`
- ✅ Fallback rule-based classification
- ✅ Priority rules for bot prompts, questions, draft edits

### People & Opt-in Management
- ✅ Auto upsert on every inbound message
- ✅ `sms_optin` table with nullable name
- ✅ `needs_name` flag tracking
- ✅ Name collection on first use
- ✅ Update name via "I'm X" declarations

### Partial Unique Index
- ✅ One active draft per type per phone
- ✅ Database constraint: `WHERE status IN ('drafting','ready')`

---

## 🔨 In Progress / Needs Implementation

### Short-Circuit Routing (Priority Fix)
- ⚠️ LLM context classification exists but doesn't short-circuit query detection
- Current: Logs high-confidence context but still runs query handlers
- Needed: Return early if `confidence >= 0.75` AND `isDraftContext(ctx.type)`
- Location: `src/app/api/twilio/sms/route.ts` line 608-623

### Background Draft Manager
- ⚠️ Draft ping logic exists but not properly triggered
- Current: Only pings after queries if drafts exist
- Needed: Ping after ANY non-draft reply if drafts are pending
- Location: Lines 1857-1860 and 2087-2095 need consolidation

### Draft Lifecycle FSM
- ⚠️ Status tracking exists but not fully enforced
- States: `Idle`, `Drafting`, `ReadyToSend`, `Sent`, `Discarded`
- Transitions partially implemented
- Needed: Explicit state transitions with validation

### Poll Response Parsing
- ⚠️ Basic parsing exists in `parseResponseWithNotes`
- Needed: Better note extraction from appendages like "yes, 5 mins late"
- Current regex handles basic cases, needs refinement

### Temporal Sweep (Timeout)
- ❌ No timeout sweep for expired drafts
- Needed: Cron job to mark `Discarded` after N hours
- Configurable TTL (e.g., 6 hours)

---

## 🔍 Architecture Review Needed

### Priority Order (Current vs Spec)
Current order in `route.ts`:
1. Name detection
2. Conversation context (logging only - doesn't short-circuit)
3. Send commands
4. Poll responses
5. Poll question input
6. Query detection
7. Draft editing
8. Tone modifications
9. Delete/Cancel

**Issue**: Context classification happens but doesn't prevent query detection.

**Fix needed**: Move draft handlers before query detection, or add explicit return.

---

## 📝 Spec Compliance

| Feature | Status | Notes |
|---------|--------|-------|
| Quote preservation | ✅ Complete | Multiple quotes supported |
| Context classification | ✅ Complete | Needs short-circuit fix |
| People upserts | ✅ Complete | Auto on every message |
| Partial unique index | ✅ Complete | Database constraint exists |
| Draft FSM | ⚠️ Partial | States exist, transitions incomplete |
| Background pings | ⚠️ Partial | Logic exists but timing wrong |
| Short-circuit routing | ❌ Not implemented | Priority bug |
| Timeout sweep | ❌ Not implemented | Needs cron job |
| Poll notes | ⚠️ Partial | Basic extraction works |

---

## 🚀 Next Steps (Priority Order)

1. **Fix short-circuit routing** (30 min)
   - Add explicit return in context classification block
   - Test with high-confidence draft contexts

2. **Fix background draft manager** (1 hour)
   - Consolidate ping logic
   - Ensure pings happen after queries
   - Test "unrelated query → ping" flow

3. **Improve poll note extraction** (1 hour)
   - Enhance regex for common patterns
   - Test edge cases

4. **Add timeout sweep** (2 hours)
   - Create cron job
   - Test TTL logic

5. **Enhance FSM transitions** (2 hours)
   - Add explicit state validation
   - Log all transitions
   - Add tests

---

## 🧪 Testing Matrix

Based on spec §10:

| Case | Status | Notes |
|------|--------|-------|
| Poll create + unrelated query | ⚠️ Partial | Draft created ✅, ping timing ⚠️ |
| Quote preservation | ✅ Complete | Tested |
| Announcement no draft text | ✅ Complete | Works |
| Draft edit correction | ✅ Complete | Works |
| Poll response with note | ⚠️ Partial | Basic extraction ✅, regex needs work |
| Profanity smalltalk | ✅ Complete | Deflects |
| Send command | ✅ Complete | Works |
| Name capture | ✅ Complete | Works |

---

Last updated: After v1.1 spec implementation

