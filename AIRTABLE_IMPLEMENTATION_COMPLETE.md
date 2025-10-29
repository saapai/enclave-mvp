# Airtable Poll Integration - Implementation Complete ✅

## Summary

All requirements for the Airtable poll integration have been implemented. The system now:

1. ✅ **Creates dynamic fields per poll** - Each new poll automatically creates 3 fields in Airtable (Question, Response, Notes)
2. ✅ **Upserts by phone number** - Records are found or created based on phone number as unique identifier
3. ✅ **Syncs names everywhere** - Names are captured and updated in Supabase + Airtable
4. ✅ **Stores poll questions** - Each poll question is stored in its dedicated field
5. ✅ **Stores responses & notes** - Both are properly saved to Airtable

## What Was Implemented

### 1. Core Airtable Functions (`src/lib/airtable.ts`)

- **`normalizePhoneForAirtable()`** - Standardizes phone numbers to E.164 format (`+13853687238`)
- **`upsertAirtableRecord()`** - Finds or creates records by phone number, merges fields intelligently
- **`createAirtableFields()`** - Creates fields via Metadata API with fallback to manual creation

### 2. Enhanced Poll Functions (`src/lib/polls.ts`)

- **`createAirtableFieldsForPoll()`** - Now actually creates fields (not just names them)
  - Sanitizes question text for valid field names
  - Uses Metadata API if available
  - Falls back gracefully with detailed logging
  
- **`recordPollResponse()`** - Completely rewritten with proper upsert logic
  - Uses phone number normalization
  - Stores poll question in dedicated field
  - Merges with existing records
  
- **`updateNameEverywhere()`** - NEW function that syncs names across all systems
  - Updates `sms_optin` table
  - Updates all `sms_poll_response` records
  - Upserts Airtable record

- **`sendPoll()`** - Now creates fields BEFORE sending poll (ensures fields exist when users respond)

### 3. SMS Handler Updates (`src/app/api/twilio/sms/route.ts`)

- Replaced duplicate Airtable update code with `updateNameEverywhere()` calls
- Name detection flow now syncs everywhere automatically

### 4. Environment Configuration

- Added `AIRTABLE_TABLE_ID` to `env.ts` and `env.example`
- Updated docs with instructions for getting Table ID

## Field Naming Convention

Fields are created with this pattern:
- **Question:** `{sanitized_question}_Question_{YYYY_MM_DD}`
- **Response:** `{sanitized_question}_Response_{YYYY_MM_DD}`
- **Notes:** `{sanitized_question}_Notes_{YYYY_MM_DD}`

**Example:**
- Question: "is ash hot"
- Fields: `is_ash_hot_Question_2025_01_15`, `is_ash_hot_Response_2025_01_15`, `is_ash_hot_Notes_2025_01_15`

## Phone Number Normalization

All phone numbers are normalized to **E.164 format** (`+13853687238`) for consistent lookups:
- Input: `3853687238` → Output: `+13853687238`
- Input: `+13853687238` → Output: `+13853687238`
- Input: `+1 385-368-7238` → Output: `+13853687238`

## Name Capture Flow

1. **First Contact:** User texts → Bot asks for name → User provides → Saved everywhere
2. **Update:** User says "i'm saathvik" → `isNameDeclaration()` detects → `updateNameEverywhere()` syncs
3. **Poll Response:** Name from `sms_optin` used, synced to Airtable if not present

## Upsert Logic

When a poll response is recorded:

1. **Supabase:** Upsert `sms_poll_response` by `(poll_id, phone)` unique constraint
2. **Airtable:** 
   - Search for record by phone number
   - If found → Update existing record (merge fields)
   - If not found → Create new record with phone + response

## Fallback Behavior

If Metadata API is unavailable or fails:

1. System logs detailed error with exact field names needed
2. Admin can manually create fields in Airtable
3. System continues storing field names in database
4. Responses still work (will fail silently if fields don't exist, but Supabase storage succeeds)

## Setup Required

1. **Get Table ID:**
   - Open Airtable base
   - Click table → Copy table ID from URL: `https://airtable.com/{BASE_ID}/{TABLE_ID}/...`
   
2. **Add to `.env.local`:**
   ```env
   AIRTABLE_API_KEY=pat_...
   AIRTABLE_BASE_ID=app_...
   AIRTABLE_TABLE_ID=tbl_...
   AIRTABLE_TABLE_NAME=Enclave RSVP
   ```

3. **Ensure base has:**
   - `Person` field (Single line text)
   - `phone number` field (Phone number type)

## Testing Checklist

- [ ] Create a poll → Verify fields are created in Airtable
- [ ] Respond to poll → Verify record is created/updated in Airtable
- [ ] Provide name → Verify name appears in Airtable
- [ ] Update name → Verify update syncs to Airtable
- [ ] Multiple polls → Verify each gets its own fields

## Files Modified

- `src/lib/airtable.ts` - New helper functions
- `src/lib/polls.ts` - Enhanced poll logic
- `src/lib/env.ts` - Added `AIRTABLE_TABLE_ID`
- `src/app/api/twilio/sms/route.ts` - Integrated name updates
- `env.example` - Added Airtable config
- `AIRTABLE_POLL_INTEGRATION_ANALYSIS.md` - Deep dive documentation (NEW)

## Next Steps

1. Deploy to production
2. Test with a real poll
3. Monitor logs for Metadata API success/failures
4. If Metadata API fails → Manually create first set of fields following naming convention

---

**Status:** ✅ Ready for Production Testing

