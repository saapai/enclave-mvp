# 🚨 CRITICAL: Calendar & Google Docs Search Fix

## Current Status

### ✅ What's Working:
- Calendar events are syncing successfully (13 events synced)
- Calendar events are being stored in database (26 total events)
- Embeddings are being generated for calendar events

### ❌ What's NOT Working:
1. **Calendar search returns 0 results** even though events exist
2. **Google Docs search fails** with `relation "google_docs_chunks" does not exist`

## Root Causes

### 1. Calendar Search Issue
The calendar events are stored in the `calendar_events` table, but the search function `search_calendar_events_vector` either:
- Doesn't exist in the database yet
- Has wrong return type (REAL vs FLOAT8)
- Needs to be created/updated

### 2. Google Docs Table Name Confusion
- **Correct table name**: `google_doc_chunks` (singular)
- **Wrong table name in old migrations**: `google_docs_chunks` (plural)
- The error message indicates the function is looking for the wrong table name

## 🔧 IMMEDIATE FIXES REQUIRED

Run these SQL scripts in Supabase **IN THIS EXACT ORDER**:

### Step 1: Create Base Schemas (if not already done)

```sql
-- 1. Run database/google-calendar-schema.sql
-- This creates:
--   - sources_google_calendar table
--   - calendar_events table
--   - search_calendar_events_vector function (base version)
```

```sql
-- 2. Run database/google-docs-schema.sql  
-- This creates:
--   - sources_google_docs table
--   - google_doc_chunks table (singular!)
--   - search_google_docs_vector function (base version)
```

### Step 2: Update Search Functions with User Filtering

```sql
-- 3. Run database/fix-calendar-search-user-filtering.sql
-- This updates search_calendar_events_vector to:
--   - Return FLOAT8 instead of REAL (fixes type mismatch)
--   - Add user filtering for personal workspace isolation
--   - Join with sources_google_calendar to get added_by field
```

```sql
-- 4. Run database/fix-google-docs-search-user-filtering.sql
-- This updates search_google_docs_vector to:
--   - Use correct table name: google_doc_chunks (singular)
--   - Add user filtering for personal workspace isolation
--   - Join with sources_google_docs to get added_by field
```

### Step 3: Update Resource Search Functions

```sql
-- 5. Run database/fix-fts-search-user-filtering.sql
-- Updates search_resources_fts for user filtering
```

```sql
-- 6. Run database/fix-vector-search-user-filtering.sql
-- Updates search_resources_vector for user filtering
```

## 🎯 Expected Results After Fixes

### Calendar Search:
- Query "when is my run" should find calendar events with "Run" or "run" in the title
- Should return events from `calendar_events` table
- Should respect user isolation (personal workspace shows only your events)

### Google Docs Search:
- Should search `google_doc_chunks` table (singular)
- Should return matching chunks from Google Docs
- Should respect user isolation (personal workspace shows only your docs)

## 🔍 Verification Steps

After running all migrations, test:

1. **Calendar Search Test**:
   ```
   Query: "when is my run"
   Expected: Should find "Run" and "run" events from calendar
   ```

2. **Google Docs Search Test**:
   ```
   Query: any text from your Google Docs
   Expected: Should find matching chunks from your docs
   ```

3. **User Isolation Test**:
   ```
   - Create new account
   - Should NOT see other user's calendar events or Google Docs
   - Should only see own resources in personal workspace
   ```

## 📊 Current Database State

From logs, we can see:
- **Total resources**: 36
  - Uploads: 8
  - Calendar events (gcal): 26 ✅
  - Google Docs (gdoc): 2
- **User's resources**: 8 (uploads only, calendar events not counted as "user's")

This confirms calendar events are in the database but not being found by search!

## 🚀 Action Items

1. ✅ **Code fixes deployed** - All code changes are live
2. ⏳ **Database migrations pending** - Need to run 6 SQL scripts in Supabase
3. ⏳ **Testing required** - Verify calendar and Google Docs search after migrations

## 📝 Notes

- The calendar events are stored with `created_by: null` in the resource table
- They're linked via `source: 'gcal'` 
- The search should use the `calendar_events` table directly, not the `resource` table
- Google Docs chunks are stored in `google_doc_chunks` (singular), not `google_docs_chunks` (plural)

---

**Next Step**: Run the 6 SQL migrations in Supabase in the order listed above! 🎯
