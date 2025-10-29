# Knowledge Graph Fix - Step-by-Step Guide

## Issue
The knowledge graph is throwing this error when querying:
```
invalid UNION/INTERSECT/EXCEPT ORDER BY clause
```

## Solution

### Step 1: Run SQL Fix in Supabase

1. Go to your Supabase dashboard
2. Open the SQL Editor
3. Run this SQL:

```sql
-- Fix Knowledge Graph Functions
-- Run this in Supabase SQL Editor to fix the ORDER BY error

CREATE OR REPLACE FUNCTION find_event_by_name(
  search_name TEXT,
  target_space_id UUID
)
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  location TEXT,
  match_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH direct_matches AS (
    -- Direct name match
    SELECT 
      e.id,
      e.name,
      e.start_at,
      e.end_at,
      e.location,
      'direct'::TEXT as match_type
    FROM event e
    WHERE e.space_id = target_space_id
      AND e.name ILIKE '%' || search_name || '%'
  ),
  alias_matches AS (
    -- Alias match
    SELECT 
      e.id,
      e.name,
      e.start_at,
      e.end_at,
      e.location,
      'alias'::TEXT as match_type
    FROM event e
    JOIN event_alias ea ON ea.event_id = e.id
    WHERE e.space_id = target_space_id
      AND ea.alias ILIKE '%' || search_name || '%'
  )
  SELECT * FROM direct_matches
  UNION ALL
  SELECT * FROM alias_matches
  ORDER BY match_type, event_name
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;
```

### Step 2: Populate Knowledge Graph

Run the consolidator to extract events from your documents:

**Option A: Via Internal API (Production)**
```bash
curl -X POST https://www.tryenclave.com/api/internal/consolidate \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_INTERNAL_API_KEY" \
  -d '{"workspaceId":"YOUR_WORKSPACE_ID"}'
```

**Option B: Via Consolidator Script (Local)**
```bash
cd /path/to/enclave-mvp
./run-consolidator.sh
```

### Step 3: Test Knowledge Graph

1. Text your SEP number: "When is active meeting"
2. Check logs - should see:
   - `[search_knowledge] Found X events` (no error)
   - Proper event data returned

### Step 4: Verify Events Were Created

Run in Supabase SQL Editor:
```sql
SELECT * FROM event WHERE space_id = 'YOUR_WORKSPACE_ID';
```

You should see events like:
- "Active meeting"
- "Big Little"
- "Study Hall"
- etc.

## What This Fixes

1. **SQL Error**: The ORDER BY clause in UNION is now properly scoped
2. **Event Queries**: Queries like "when is active meeting" will work
3. **Knowledge Graph**: Planner will use structured event data

## Next Steps After Fix

Once the knowledge graph is populated, queries like:
- "When is active meeting" → Returns structured event data
- "What is big little" → Returns policy information
- "Where is futsal" → Returns location data

Will use the knowledge graph FIRST, then fall back to doc search if needed.

