# Airtable Poll Integration - Deep Dive Analysis

## Executive Summary

This document provides a comprehensive analysis of how the Airtable integration for poll responses should work, including dynamic field creation, upsert logic, and name capture flow.

---

## 1. Current Implementation Analysis

### 1.1 Database Schema

**Tables:**
- `sms_poll` - Stores poll metadata (question, options, status, Airtable field names)
- `sms_poll_response` - Stores individual responses (phone, option, notes, person_name)
- `sms_optin` - Stores user opt-in info (phone, name, needs_name flag)

**Key Fields:**
```sql
sms_poll:
  - airtable_question_field TEXT
  - airtable_response_field TEXT  
  - airtable_notes_field TEXT

sms_poll_response:
  - phone TEXT (unique identifier)
  - person_name TEXT
  - option_label TEXT
  - notes TEXT
```

### 1.2 Current Flow

**Poll Creation:**
1. User says "I want to make a poll asking if people think ash is hot"
2. System extracts question and creates draft
3. User confirms → poll sent to all opted-in users
4. `createAirtableFieldsForPoll()` generates field names but **DOES NOT CREATE THEM** (just stores names)

**Poll Response:**
1. User texts response (e.g., "yes", "maybe but running late")
2. System parses response + notes
3. Gets name from `sms_optin` table
4. Calls `recordPollResponse()` which:
   - Upserts to `sms_poll_response` table
   - **Tries to upsert to Airtable** but fields may not exist yet

**Name Capture:**
1. First message → `needs_name = true` → asks for name
2. User provides name → saved to `sms_optin.name`
3. Later updates via "i'm X" pattern → updates via `saveName()`

---

## 2. Requirements

### 2.1 Dynamic Field Creation
- **Every new poll** should create 3 new fields in Airtable:
  1. `{Poll Question} Question` - Stores the poll question itself
  2. `{Poll Question} Response` - Stores the response (Yes/No/Maybe)
  3. `{Poll Question} Notes` - Stores additional notes

### 2.2 Upsert Logic
- **Primary Key:** Phone number (`phone number` column)
- **Behavior:** If record exists → update, else → create
- **Always update:** Person name (if provided/changed)

### 2.3 Name Capture
- **Initial:** Ask at first text (current: `needs_name` flag)
- **Updates:** Support "i'm X", "my name is X", "call me X" (current: `isNameDeclaration()`)
- **Persist:** Update all existing records (both Supabase and Airtable)

---

## 3. Issues & Gaps

### 3.1 Field Creation Problem
**Issue:** `createAirtableFieldsForPoll()` only generates field names but doesn't actually create them in Airtable.

**Current Code:**
```typescript
// Line 285-321 in polls.ts
export async function createAirtableFieldsForPoll(...)
  // ... generates field names
  // Note: This requires Airtable Enterprise or using the web API
  // For now, we'll store the field names and let Airtable auto-create them on first insert
```

**Problem:** Airtable won't auto-create fields on first insert. Fields must be created explicitly via Airtable Metadata API.

### 3.2 Phone Number Format Inconsistency
**Issue:** Phone numbers stored in different formats:
- Database: `3853687238` (normalized, no +1)
- Airtable: `+13853687238` or `3853687238` (inconsistent)
- Twilio: `+13853687238` (E.164 format)

**Impact:** Upsert may fail if formats don't match.

### 3.3 Question Field Not Populated
**Issue:** The poll question itself isn't stored in Airtable. Only response and notes go into fields.

**Need:** Each person's record should have the poll question stored when they respond (or poll is created).

### 3.4 Name Updates Not Fully Synchronized
**Issue:** Name updates only sync to:
- `sms_poll_response` table (all records for phone)
- Airtable (if record exists when name is updated)

**Gap:** If name is updated before user responds to poll, Airtable may not have record yet → name lost.

---

## 4. Proposed Solution

### 4.1 Field Creation Strategy

**Option A: Metadata API (Recommended)**
- Use Airtable Metadata API to create fields when poll is created
- Requires Airtable API key with base scoping
- Fields created: `{Question Short Name} Question`, `{Question Short Name} Response`, `{Question Short Name} Notes`

**Option B: Manual Setup + Dynamic Mapping**
- Admin creates fields manually in Airtable
- System maps poll question → field name using pattern matching
- Less reliable but simpler

**Option C: Single Multi-Select Field (Not Recommended)**
- Store all poll responses in a single "Poll Responses" field
- Lose structure, harder to query

**RECOMMENDATION: Option A** - Create fields dynamically via Metadata API.

### 4.2 Data Model Design

**Airtable Schema:**
```
Person (Text)          - Person's name
phone number (Phone)   - Unique identifier (E.164: +13853687238)
Poll 1 Question       - "is ash hot"
Poll 1 Response      - "Yes"
Poll 1 Notes          - "running 15 late"
Poll 2 Question       - "coming to active meeting"
Poll 2 Response       - "No"
Poll 2 Notes          - ""
...
```

**Upsert Strategy:**
1. Normalize phone to E.164: `+1{10 digits}`
2. Search Airtable: `filterByFormula: {phone number} = "+13853687238"`
3. If found → Update record (merge fields)
4. If not found → Create new record

**Field Naming Convention:**
- Question: `{Short Question} Question` (e.g., "is ash hot Question")
- Response: `{Short Question} Response` (e.g., "is ash hot Response")
- Notes: `{Short Question} Notes` (e.g., "is ash hot Notes")

**Short Question Generation:**
- Max 30 chars
- Remove special chars, lowercase
- Use first 30 chars of question
- Append date if needed: `{short}_2025-01-15`

### 4.3 Name Capture Flow

**Initial Contact:**
```
User: [Any message]
Bot: "hey! what's your name? (just reply with your first name)"
User: "Saathvik"
Bot: "hey saathvik! i'm enclave..."
```

**Update Flow:**
```
User: "i'm saathvik"
Bot: "got it! i'll call you saathvik"
[Updates: sms_optin.name, sms_poll_response.person_name (all), Airtable.Person]
```

**Clarification Flow:**
```
User: "my name is actually mike"
Bot: "got it! i'll call you mike"
[Updates everywhere]
```

**Implementation:**
1. Detect name declarations via `isNameDeclaration()` (already implemented)
2. Update `sms_optin.name` table
3. Update all `sms_poll_response.person_name` for that phone
4. Upsert Airtable record (create or update `Person` field)

### 4.4 Poll Response Flow

**When Poll is Created:**
1. Generate short question name (max 30 chars)
2. Create 3 Airtable fields via Metadata API:
   - `{short} Question`
   - `{short} Response`
   - `{short} Notes`
3. Store field names in `sms_poll.airtable_*_field` columns
4. Send poll to all recipients

**When User Responds:**
1. Parse response: `parseResponseWithNotes()` → {option, notes}
2. Get or ask for name:
   - Check `sms_optin.name`
   - Check `sms_poll_response.person_name` (existing responses)
   - If none → ask: "what's your name?"
3. Record response:
   - Upsert `sms_poll_response` (phone + poll_id)
   - Upsert Airtable:
     - Find by phone number
     - Set `Person` = name
     - Set `{short} Question` = poll.question
     - Set `{short} Response` = option
     - Set `{short} Notes` = notes (if exists)

**Phone Number Normalization:**
```typescript
function normalizePhoneForAirtable(phone: string): string {
  // Input: "+13853687238" or "3853687238"
  // Output: "+13853687238" (E.164)
  
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 10) {
    return `+1${digits}`
  } else if (digits.length === 11 && digits[0] === '1') {
    return `+${digits}`
  } else if (phone.startsWith('+')) {
    return phone
  }
  return `+1${digits}` // Default to US +1
}
```

---

## 5. Implementation Plan

### 5.1 Create Airtable Fields API

**New Function:** `createAirtableFieldsForPoll()`
```typescript
async function createAirtableFieldsForPoll(
  pollQuestion: string,
  baseId: string,
  tableId: string,
  apiKey: string
): Promise<{questionField: string, responseField: string, notesField: string}>
```

**Steps:**
1. Generate short question name (sanitize, truncate to 30 chars)
2. Call Airtable Metadata API:
   ```
   POST https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}/fields
   Headers: Authorization: Bearer {apiKey}
   Body: {
     fields: [
       {
         name: "{short} Question",
         type: "singleLineText"
       },
       {
         name: "{short} Response",
         type: "singleSelect",
         options: {
           choices: ["Yes", "No", "Maybe"]
         }
       },
       {
         name: "{short} Notes",
         type: "multilineText"
       }
     ]
   }
   ```
3. Return field names
4. Store in `sms_poll.airtable_*_field` columns

**Error Handling:**
- If field already exists → return existing field name
- If API fails → log error, return fallback names, continue

### 5.2 Enhanced Upsert Function

**Update:** `recordPollResponse()`
```typescript
async function recordPollResponse(
  pollId: string,
  phone: string,
  option: string,
  notes?: string,
  personName?: string
): Promise<boolean>
```

**Steps:**
1. Get poll details (including Airtable field names)
2. Normalize phone to E.164
3. Upsert Supabase `sms_poll_response`
4. Upsert Airtable:
   ```typescript
   const normalizedPhone = normalizePhoneForAirtable(phone)
   
   // Find existing record
   const records = await base(tableName)
     .select({
       filterByFormula: `{phone number} = "${normalizedPhone}"`
     })
     .firstPage()
   
   const fields = {
     'Person': personName || 'Unknown',
     'phone number': normalizedPhone,
     [poll.airtable_question_field]: poll.question,
     [poll.airtable_response_field]: option
   }
   
   if (notes) {
     fields[poll.airtable_notes_field] = notes
   }
   
   if (records.length > 0) {
     // Update
     await base(tableName).update([{
       id: records[0].id,
       fields: { ...records[0].fields, ...fields }
     }])
   } else {
     // Create
     await base(tableName).create([{ fields }])
   }
   ```

### 5.3 Name Update Flow

**New Function:** `updateNameEverywhere()`
```typescript
async function updateNameEverywhere(phone: string, name: string): Promise<void>
```

**Steps:**
1. Update `sms_optin.name`
2. Update all `sms_poll_response.person_name` for phone
3. Upsert Airtable:
   - Find by phone number
   - Update `Person` field
   - If record doesn't exist → create with phone + name

**Integration Points:**
- `isNameDeclaration()` success → call `updateNameEverywhere()`
- `needs_name` flow → call `updateNameEverywhere()` after name provided

### 5.4 Poll Creation Flow Update

**Update:** `sendPoll()`
```typescript
async function sendPoll(pollId: string, twilioClient: any): Promise<...>
```

**Add before sending:**
```typescript
// Create Airtable fields
const airtableFields = await createAirtableFieldsForPoll(
  poll.question,
  ENV.AIRTABLE_BASE_ID,
  ENV.AIRTABLE_TABLE_ID, // NEW: Need table ID, not just name
  ENV.AIRTABLE_API_KEY
)

// Update poll with field names
await supabaseAdmin
  .from('sms_poll')
  .update({
    airtable_question_field: airtableFields.questionField,
    airtable_response_field: airtableFields.responseField,
    airtable_notes_field: airtableFields.notesField
  })
  .eq('id', pollId)

// Then send poll...
```

---

## 6. Configuration Requirements

### 6.1 Environment Variables

**Current:**
```env
AIRTABLE_API_KEY=pat_...
AIRTABLE_BASE_ID=app_...
AIRTABLE_TABLE_NAME=Enclave RSVP
AIRTABLE_PUBLIC_RESULTS_URL=https://airtable.com/...
```

**New Requirements:**
```env
AIRTABLE_API_KEY=pat_... # Must have Metadata API access
AIRTABLE_BASE_ID=app_... # Base ID
AIRTABLE_TABLE_ID=tbl_... # Table ID (needed for Metadata API) - NEW
AIRTABLE_TABLE_NAME=Enclave RSVP # Still needed for reading/writing
AIRTABLE_PUBLIC_RESULTS_URL=https://airtable.com/...
```

**How to Get Table ID:**
1. Open Airtable base
2. Click table name → "Copy table ID" (in URL: `https://airtable.com/{BASE_ID}/{TABLE_ID}/...`)

### 6.2 Airtable Base Setup

**Required:**
- Base with at least one table (e.g., "Enclave RSVP")
- Table must have these base columns:
  - `Person` (Single line text)
  - `phone number` (Phone number field)
  
**Optional (will be created dynamically):**
- Poll-specific columns (created per poll)

---

## 7. Edge Cases & Error Handling

### 7.1 Field Already Exists
**Scenario:** Admin manually created field with same name
**Handling:** Catch error, use existing field name, continue

### 7.2 Metadata API Fails
**Scenario:** No Metadata API access, or quota exceeded
**Handling:** Log error, store fallback field names, prompt admin to create manually

### 7.3 Phone Number Not Found in Airtable
**Scenario:** User responds before Airtable record exists
**Handling:** Create new record with phone + response + name

### 7.4 Name Not Provided
**Scenario:** User responds to poll but never provided name
**Handling:** Store as "Unknown", update when name is provided later

### 7.5 Multiple Polls Active
**Scenario:** Multiple polls sent, user responds to both
**Handling:** Each poll gets own fields, responses stored independently

### 7.6 Duplicate Phone Numbers
**Scenario:** Same phone responds twice to same poll
**Handling:** Upsert updates existing response (Supabase UNIQUE constraint prevents duplicates)

---

## 8. Testing Scenarios

### 8.1 First-Time User Flow
```
1. User texts "SEP"
2. Bot: "hey! what's your name?"
3. User: "Saathvik"
4. Bot: "hey saathvik! i'm enclave..."
5. Poll sent: "yo are you coming to active meeting"
6. User: "yes"
7. Bot: "Thanks Saathvik! Recorded: Yes"
```

**Expected:**
- Airtable record created: `Person=Saathvik`, `phone number=+13853687238`, `{poll} Question=...`, `{poll} Response=Yes`

### 8.2 Name Update Flow
```
1. Existing user (name="Mike")
2. User: "i'm actually saathvik"
3. Bot: "got it! i'll call you saathvik"
```

**Expected:**
- Airtable record updated: `Person=Saathvik` (was Mike)
- All `sms_poll_response` records updated

### 8.3 Poll Response with Notes
```
1. Poll: "yo are you coming to active meeting"
2. User: "yes but running 15 late"
3. Bot: "Thanks Saathvik! Recorded: Yes (note: running 15 late)"
```

**Expected:**
- Airtable: `{poll} Response=Yes`, `{poll} Notes=running 15 late`

### 8.4 Multiple Polls
```
1. Poll 1: "is ash hot"
2. User: "yes"
3. Poll 2: "coming to active meeting"
4. User: "maybe"
```

**Expected:**
- Airtable has both fields:
  - `is ash hot Response=Yes`
  - `coming to active meeting Response=Maybe`

---

## 9. Implementation Checklist

- [ ] Add `AIRTABLE_TABLE_ID` to env vars
- [ ] Create `createAirtableFieldsForPoll()` with Metadata API
- [ ] Create `normalizePhoneForAirtable()` helper
- [ ] Update `recordPollResponse()` with proper upsert logic
- [ ] Update `sendPoll()` to create fields before sending
- [ ] Create `updateNameEverywhere()` function
- [ ] Integrate name updates into `isNameDeclaration()` flow
- [ ] Integrate name updates into `needs_name` flow
- [ ] Add error handling for field creation failures
- [ ] Test first-time user flow
- [ ] Test name update flow
- [ ] Test multiple polls
- [ ] Test phone number normalization
- [ ] Add logging for Airtable operations

---

## 10. Code Structure

### 10.1 New Files

**None** - All changes in existing files:
- `src/lib/polls.ts` - Main poll logic
- `src/lib/airtable.ts` - Airtable helpers (extend)
- `src/app/api/twilio/sms/route.ts` - Name detection (already has `isNameDeclaration()`)

### 10.2 Modified Functions

**In `polls.ts`:**
- `createAirtableFieldsForPoll()` - Implement actual field creation
- `recordPollResponse()` - Fix upsert logic, phone normalization
- `sendPoll()` - Call field creation before sending
- `updateNameEverywhere()` - NEW (or merge into `saveName()`)

**In `airtable.ts`:**
- `normalizePhoneForAirtable()` - NEW helper
- `upsertAirtableRecord()` - NEW (used by `recordPollResponse()`)

---

## 11. Success Criteria

✅ **Every new poll creates 3 fields in Airtable**
✅ **Responses upsert correctly by phone number**
✅ **Names captured and updated everywhere**
✅ **Phone numbers normalized consistently**
✅ **Question, response, and notes stored correctly**
✅ **Multiple polls work independently**

---

## 12. Implementation Notes

### 12.1 Metadata API Availability

**Current Status:** Airtable Metadata API is in **beta** and requires:
- Airtable Enterprise plan OR
- Base with Metadata API access granted

**Fallback Strategy:**
1. Try Metadata API to create fields
2. If fails → Check if fields exist (via list fields)
3. If fields don't exist → Log error + provide admin instructions
4. Continue with field names stored in database (admin creates manually)

**Alternative Approach:** Use consistent field naming pattern so admin can pre-create columns in batches.

### 12.2 Field Naming Convention

**Standard Format:**
- Question: `{sanitized_question}_Question`
- Response: `{sanitized_question}_Response`
- Notes: `{sanitized_question}_Notes`

**Sanitization Rules:**
1. Lowercase
2. Replace spaces with underscores
3. Remove special chars (keep alphanumeric + underscore)
4. Truncate to 25 chars max
5. Append timestamp (YYYY-MM-DD) if needed to avoid collisions

**Example:**
```
Question: "is ash hot"
→ Fields: "is_ash_hot_Question", "is_ash_hot_Response", "is_ash_hot_Notes"

Question: "coming to active meeting tonight"
→ Fields: "coming_to_active_mee_Question", "coming_to_active_mee_Response", "coming_to_active_mee_Notes"
```

### 12.3 Practical Implementation

**Phase 1: Metadata API (Preferred)**
```typescript
// Try to create fields via Metadata API
POST https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}/fields
```

**Phase 2: Field Existence Check (Fallback)**
```typescript
// List existing fields to verify
GET https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}
// Check if our fields exist in response.schema.fields[]
```

**Phase 3: Graceful Degradation**
```typescript
// If fields don't exist:
// 1. Log detailed error with field names needed
// 2. Store poll with airtable_*_field names (for future)
// 3. Continue with Supabase storage (fully functional)
// 4. Admin creates fields manually when ready
// 5. Re-run field creation or manual sync
```

## 13. Next Steps

1. ✅ Review this analysis
2. ⚠️ Check if Metadata API is available (try test call)
3. 📋 If not available → Document manual field creation process
4. 🔧 Implement field creation with try/catch fallback
5. 🔧 Implement field existence check
6. 🔧 Update upsert logic with phone normalization
7. 🔧 Test name capture flow
8. ✅ Test with sample polls
9. 📖 Create admin guide for manual field setup
10. 🚀 Deploy and monitor

