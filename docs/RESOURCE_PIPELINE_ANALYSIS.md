# Resource Upload & Search Pipeline Analysis

## Executive Summary

The user's core issue: **"Active meeting" returns "SEP Fall Quarter" generic text instead of the specific event card.**

Root causes identified:
1. **Early-stop on first FTS hit** prevents comprehensive recall
2. **Vector dimensions mismatch** (DB expects 1024, OpenAI returns 1536)
3. **No entity extraction or reranking** to prefer event cards over generic docs
4. **Missing structured event parsing** from resource cards

---

## 1. CURRENT UPLOAD PIPELINE

### A. File Upload Flow (`/api/upload/route.ts`)

```
User uploads file → Extract text → Insert to DB → Generate embeddings → Store chunks
```

**Key Steps:**

1. **Text Extraction** (lines 36-147):
   - PDFs: `pdf-parse` library extracts text
   - Text files: Direct read
   - Images: OCR disabled (Tesseract issues)

2. **Database Insert** (lines 260-283):
   ```sql
   INSERT INTO resource (
     space_id,      -- UUID of workspace
     type,          -- 'event', 'doc', 'form', 'link', 'faq'
     title,         -- Sanitized title or filename
     body,          -- Extracted text or description
     url,           -- File storage URL or external link
     source,        -- 'upload', 'gdoc', 'gcal', 'slack', 'sms'
     visibility,    -- 'space' (default)
     created_by     -- Clerk user ID (TEXT)
   )
   ```

3. **Embedding Generation** (lines 373-401):
   - **Text for embedding**: `title + "\n\n" + body`
   - **Model**: OpenAI `text-embedding-3-small` (1536 dims)
   - **Timeout**: 2s per call, 3 retries with backoff
   - **Storage**: `resource_embedding` table
   - **Chunking**: Splits body into ~1500 char chunks, embeds each separately
   - **Storage**: `resource_chunk` table

4. **Tags & Event Metadata** (lines 322-371):
   - Tags stored in `tag` + `resource_tag` junction table
   - Event metadata (start_at, end_at, location, etc.) in `event_meta` table

---

## 2. CURRENT SEARCH PIPELINE

### A. Search V2 Architecture (`src/lib/search-v2.ts`)

```
Query → Classify embedding → FTS search → Vector search → Merge & dedupe → Compose
```

**Key Components:**

1. **Budget System**:
   - Total: 12s (configurable via `SMS_SEARCH_BUDGET_MS`)
   - FTS per workspace: 2.5s
   - Embedding generation: 4s
   - Vector per workspace: 2.5s

2. **FTS Search** (lines 166-234):
   - Uses Postgres RPC `search_resources_fts`
   - Searches: `to_tsvector('english', title || ' ' || body)`
   - Returns: `ts_rank()` score (0.0-1.0+)
   - **Current behavior**: Stops at first high-confidence hit (≥0.85)

3. **Vector Search** (lines 240-309):
   - Uses Postgres RPC `search_resources_vector`
   - Compares query embedding to `resource_embedding.embedding`
   - Returns: cosine similarity score (0.0-1.0)
   - **Current behavior**: Skipped if FTS already found high-confidence result

4. **Workspace Iteration** (lines 315-390):
   - Sequential (not parallel) to respect budget
   - For each workspace:
     1. Run FTS
     2. Check if top FTS score ≥ 0.85 → early exit
     3. If not, run vector search (if embedding available)
   - **Problem**: First workspace with high FTS score wins, even if it's generic

5. **Merge & Dedupe** (lines 392-485):
   - Combines FTS + vector results
   - Dedupes by resource ID
   - Sorts by score descending
   - **Problem**: No reranking by entity match or source type

---

## 3. DATABASE SCHEMA

### A. Core Tables

```sql
-- Main resource table
resource (
  id UUID PRIMARY KEY,
  space_id UUID,              -- Workspace/space ID
  type TEXT,                  -- 'event', 'doc', 'form', 'link', 'faq'
  title TEXT,                 -- Resource title
  body TEXT,                  -- Full text content
  url TEXT,                   -- Storage or external URL
  source TEXT,                -- 'upload', 'gdoc', 'gcal', 'slack', 'sms'
  visibility TEXT,            -- 'space', 'public', 'private'
  created_by TEXT,            -- Clerk user ID
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

-- Vector embeddings (1024 dims - MISMATCH!)
resource_embedding (
  resource_id UUID PRIMARY KEY,
  embedding VECTOR(1024),     -- ⚠️ DB expects 1024, OpenAI returns 1536
  updated_at TIMESTAMPTZ
)

-- Text chunks with embeddings
resource_chunk (
  id UUID PRIMARY KEY,
  resource_id UUID,
  chunk_index INTEGER,
  chunk_text TEXT,
  embedding VECTOR(1024),     -- ⚠️ Same mismatch
  created_at TIMESTAMPTZ
)

-- Event metadata
event_meta (
  resource_id UUID PRIMARY KEY,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  location TEXT,
  rsvp_link TEXT,
  cost TEXT,
  dress_code TEXT
)
```

### B. Search Functions

```sql
-- FTS search (working correctly)
CREATE FUNCTION search_resources_fts(
  search_query TEXT,
  target_space_id UUID,
  limit_count INTEGER,
  offset_count INTEGER
) RETURNS TABLE (
  id, space_id, type, title, body, url, created_by,
  created_at, updated_at, rank REAL
)
-- Uses: to_tsvector('english', title || ' ' || body) @@ plainto_tsquery(search_query)
-- Index: GIN on to_tsvector (exists in supabase-setup.sql line 98)

-- Vector search (dimension mismatch!)
CREATE FUNCTION search_resources_vector(
  query_embedding float8[],
  target_space_id UUID,
  limit_count INTEGER,
  offset_count INTEGER
) RETURNS TABLE (id UUID, score float4)
-- Uses: embedding <=> query_embedding::vector(1024)  -- ⚠️ Hardcoded 1024
```

---

## 4. IDENTIFIED PROBLEMS

### Problem 1: Vector Dimension Mismatch ⚠️ CRITICAL

**Symptom**: Re-embedding script fails with "expected 1536 dimensions, not 1024"

**Root Cause**:
- Database schema: `VECTOR(1024)` (from old Mistral embeddings)
- Current code: OpenAI `text-embedding-3-small` returns 1536 dims
- Search RPCs: Hardcoded `::vector(1024)` cast

**Impact**:
- New embeddings cannot be stored
- Vector search is broken for all resources uploaded after OpenAI switch
- System falls back to FTS-only search

**Fix Required**:
```sql
-- 1. Update table schemas
ALTER TABLE resource_embedding ALTER COLUMN embedding TYPE vector(1536);
ALTER TABLE resource_chunk ALTER COLUMN embedding TYPE vector(1536);

-- 2. Update search functions
CREATE OR REPLACE FUNCTION search_resources_vector(...)
  -- Change: query_embedding::vector(1024) → query_embedding::vector
  -- Postgres will infer dimension from the embedding column

-- 3. Re-embed all existing resources
-- Run: npx tsx scripts/reembed-resources.ts
```

---

### Problem 2: Early-Stop Kills Recall

**Symptom**: "Active meeting" returns "SEP Fall Quarter" generic doc

**Root Cause** (`search-v2.ts` lines 342-346):
```typescript
const topFtsScore = ftsResults[0]?.score || 0
const highConfidence = topFtsScore >= 0.85
if (highConfidence) {
  console.log(`High-confidence FTS result, stopping search`)
  // Returns immediately, doesn't check other workspaces
}
```

**Why This Fails**:
1. Query: "When is active meeting"
2. First workspace searched: Contains "SEP Fall Quarter" doc with body text mentioning "active" and "meeting" generically
3. FTS score: 0.95 (high confidence)
4. Search stops, never checks other workspaces
5. "Active Meeting" event card in another workspace is never seen

**Fix Required**:
- Remove early-stop logic
- Search all workspaces
- Rerank results by:
  1. Entity match (title contains query entities)
  2. Resource type priority (event > doc > link)
  3. FTS/vector score
  4. Recency

---

### Problem 3: No Entity Extraction or Reranking

**Symptom**: Generic docs beat specific event cards

**Root Cause**: No logic to:
1. Extract entities from query ("active meeting", "big little", "ae summons")
2. Prefer results where `title` matches extracted entity
3. Boost event cards over generic docs

**Current Behavior**:
```typescript
// search-v2.ts line 470
deduped.sort((a, b) => (b.score || 0) - (a.score || 0))
// Just sorts by raw score, no semantic understanding
```

**Fix Required**:
```typescript
// 1. Extract entities from query
const entities = extractEntities(query) // ["active meeting"]

// 2. Rerank with entity matching
results.sort((a, b) => {
  // Exact title match
  const aExact = entities.some(e => a.title.toLowerCase().includes(e))
  const bExact = entities.some(e => b.title.toLowerCase().includes(e))
  if (aExact && !bExact) return -1
  if (!aExact && bExact) return 1
  
  // Type priority
  const typePriority = { event: 3, faq: 2, doc: 1, link: 0 }
  const aPri = typePriority[a.type] || 0
  const bPri = typePriority[b.type] || 0
  if (aPri !== bPri) return bPri - aPri
  
  // Score
  return (b.score || 0) - (a.score || 0)
})
```

---

### Problem 4: No Structured Event Parsing

**Symptom**: Answers lack date/time/location precision

**Root Cause**: Event cards are stored as free text in `body`, not parsed into structured fields

**Current Storage**:
```
title: "Active Meeting"
body: "Every Wednesday at 8:00 PM. Location: 461B Kelton or 610 Levering."
type: "event"
```

**What's Missing**:
- No extraction of `cadence: "weekly"`, `day: "Wednesday"`, `time: "8:00 PM"`
- `event_meta` table exists but is only populated for calendar imports, not manual uploads
- Answer composition relies on LLM to parse free text

**Fix Required**:
1. **At upload time**: Parse event cards for temporal/location entities
2. **Store in `event_meta`**: Populate `start_at`, `location`, etc.
3. **At query time**: Compose answers from structured fields, not free text

---

## 5. RECOMMENDED FIXES (Prioritized)

### Fix 1: Update Vector Dimensions (CRITICAL, 10 min)

**Why First**: Blocks all new embeddings, breaks vector search

**Steps**:
1. Run SQL migration:
   ```sql
   -- See: database/migrations/update-vector-dimensions-to-1536.sql
   ALTER TABLE resource_embedding ALTER COLUMN embedding TYPE vector(1536);
   ALTER TABLE resource_chunk ALTER COLUMN embedding TYPE vector(1536);
   
   -- Update search functions to use dynamic dimensions
   CREATE OR REPLACE FUNCTION search_resources_vector(...)
     -- Remove hardcoded ::vector(1024), use ::vector
   ```

2. Re-embed all resources:
   ```bash
   cd enclave-mvp
   npx tsx scripts/reembed-resources.ts
   ```

---

### Fix 2: Remove Early-Stop, Add Entity Reranking (30 min)

**File**: `src/lib/search-v2.ts`

**Changes**:

1. **Remove early-stop** (lines 342-346):
   ```typescript
   // DELETE THIS:
   const highConfidence = topFtsScore >= 0.85
   if (highConfidence) {
     console.log(`High-confidence FTS result, stopping search`)
     // early exit
   }
   ```

2. **Add entity extractor** (new function):
   ```typescript
   // Canonical entities from your uploaded cards
   const KNOWN_ENTITIES = [
     "active meeting", "actives meeting", "active", "actives",
     "big little", "big/little", "bl", "big little appreciation",
     "ae summons", "alpha epsilon summons", "ae", "alpha epsilon",
     "im futsal", "intramural futsal", "futsal",
     "study hall", "study session",
     "gm", "general meeting"
   ]
   
   function extractEntities(query: string): string[] {
     const normalized = query.toLowerCase()
       .replace(/[^\w\s]/g, ' ')
       .replace(/\s+/g, ' ')
       .trim()
     
     return KNOWN_ENTITIES.filter(entity => {
       const entityNorm = entity.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ')
       return normalized.includes(entityNorm)
     })
   }
   ```

3. **Add reranking** (replace line 470):
   ```typescript
   function rerank(results: SearchResult[], query: string): SearchResult[] {
     const entities = extractEntities(query)
     
     return results.sort((a, b) => {
       // 1. Exact entity match in title
       const aTitle = a.title?.toLowerCase() || ''
       const bTitle = b.title?.toLowerCase() || ''
       const aMatch = entities.some(e => aTitle.includes(e))
       const bMatch = entities.some(e => bTitle.includes(e))
       if (aMatch && !bMatch) return -1
       if (!aMatch && bMatch) return 1
       
       // 2. Type priority
       const typePriority: Record<string, number> = {
         event: 3, faq: 2, doc: 1, link: 0, form: 1
       }
       const aPri = typePriority[a.type] || 0
       const bPri = typePriority[b.type] || 0
       if (aPri !== bPri) return bPri - aPri
       
       // 3. Score
       return (b.score || 0) - (a.score || 0)
     })
   }
   
   // Use it:
   const reranked = rerank(deduped, query)
   ```

---

### Fix 3: Add Structured Event Parsing (1 hour)

**Goal**: Extract temporal/location entities at upload time

**File**: `src/app/api/upload/route.ts`

**New Function**:
```typescript
interface ParsedEvent {
  cadence?: 'weekly' | 'biweekly' | 'monthly' | 'once'
  day?: string // "Monday", "Tuesday", etc.
  time?: string // "8:00 PM"
  date?: string // "2025-11-13"
  location?: string
}

function parseEventFromText(text: string): ParsedEvent {
  const result: ParsedEvent = {}
  
  // Cadence
  if (/every|each\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text)) {
    result.cadence = 'weekly'
    const match = text.match(/every|each\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
    if (match) result.day = match[1]
  }
  
  // Time
  const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i)
  if (timeMatch) {
    result.time = timeMatch[0]
  }
  
  // Date
  const dateMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/)
  if (dateMatch) {
    result.date = dateMatch[0]
  }
  
  // Location (simple heuristics)
  const locMatch = text.match(/(?:at|@|location:?)\s+([^\n\.]+)/i)
  if (locMatch) {
    result.location = locMatch[1].trim()
  }
  
  return result
}
```

**Integration** (after line 283):
```typescript
// If type is 'event', parse structured fields
if (type === 'event' && extractedText) {
  const parsed = parseEventFromText(extractedText)
  console.log('Parsed event fields:', parsed)
  
  // Store in event_meta for each resource
  for (const resource of insertedResources) {
    await dbClient.from('event_meta').upsert({
      resource_id: (resource as any).id,
      // Convert parsed fields to event_meta schema
      location: parsed.location || null,
      // Add custom JSON field for cadence/day/time if needed
    })
  }
}
```

---

### Fix 4: Improve FTS Ranking with Field Weighting (30 min)

**Goal**: Boost title matches over body matches

**File**: `database/fixes/improve-fts-ranking.sql`

```sql
-- Update search_resources_fts to weight title higher
CREATE OR REPLACE FUNCTION search_resources_fts(
  search_query TEXT,
  target_space_id UUID,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID, space_id UUID, type TEXT, title TEXT, body TEXT,
  url TEXT, created_by TEXT, created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ, rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id, r.space_id, r.type, r.title, r.body, r.url,
    r.created_by, r.created_at, r.updated_at,
    (
      -- Title weight: 3.0
      ts_rank(
        to_tsvector('english', coalesce(r.title, '')),
        plainto_tsquery('english', search_query)
      ) * 3.0
      +
      -- Body weight: 1.0
      ts_rank(
        to_tsvector('english', coalesce(r.body, '')),
        plainto_tsquery('english', search_query)
      ) * 1.0
    ) AS rank
  FROM resource r
  WHERE r.space_id = target_space_id
    AND (
      to_tsvector('english', coalesce(r.title, '')) @@ plainto_tsquery('english', search_query)
      OR
      to_tsvector('english', coalesce(r.body, '')) @@ plainto_tsquery('english', search_query)
    )
  ORDER BY rank DESC, r.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### Fix 5: Add Trigram Index for Fuzzy Matching (15 min)

**Goal**: Match "appreciation" to "Appreciation Day", "actives" to "active"

**File**: `database/fixes/add-trigram-indexes.sql`

```sql
-- Enable pg_trgm extension (already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram index on title for fuzzy matching
CREATE INDEX IF NOT EXISTS resource_title_trgm_idx 
  ON resource USING gin (title gin_trgm_ops);

-- Add trigram index on event names in knowledge graph (if using)
CREATE INDEX IF NOT EXISTS event_name_trgm_idx 
  ON event USING gin (name gin_trgm_ops);
```

---

## 6. TESTING PLAN

### Test Queries (from user's logs):

1. **"When is active meeting"**
   - Expected: "Every Wednesday at 8:00 PM. Location: 461B Kelton or 610 Levering."
   - Current: Returns "SEP Fall Quarter" generic text

2. **"When is big little"**
   - Expected: "November 13th (time and location TBD)"
   - Current: Works via FAQ (should work via search)

3. **"When is ae summons"**
   - Expected: Specific date/time/location
   - Current: Not found or returns generic text

4. **"When is futsal"** / **"When is im futsal"**
   - Expected: "Wednesdays at 7:00 PM at SAC"
   - Current: Not found

### Success Criteria:

- [ ] All 4 queries return the correct event card (not generic docs)
- [ ] Answers include date/time/location extracted from cards
- [ ] Vector search works (embeddings stored and retrieved)
- [ ] No early-stop (all workspaces searched)
- [ ] Logs show entity extraction and reranking

---

## 7. OBSERVABILITY IMPROVEMENTS

### Add to `search-v2.ts` (hybridSearchV2 function):

```typescript
console.log('[Search V2] Query completed:', {
  query,
  workspaces_searched: workspaceIds.length,
  total_results: deduped.length,
  top_3_titles: deduped.slice(0, 3).map(r => r.title),
  top_3_scores: deduped.slice(0, 3).map(r => r.score?.toFixed(3)),
  top_3_types: deduped.slice(0, 3).map(r => r.type),
  entities_extracted: extractEntities(query),
  stop_reason: 'deadline' // or 'budget_exhausted', 'all_searched'
})
```

### Add to `answer.ts` (composeDirectResponse):

```typescript
console.log('[Answer] Composition:', {
  query,
  top_result_title: topHit.title,
  top_result_type: topHit.type,
  extracted_fields: {
    date: extractedDate,
    time: extractedTime,
    location: extractedLocation
  },
  answerable: hasDate || hasTime || hasLocation
})
```

---

## 8. IMPLEMENTATION ORDER

1. **Fix vector dimensions** (10 min) - CRITICAL, blocks everything else
2. **Remove early-stop** (5 min) - Quick win, improves recall
3. **Add entity extraction & reranking** (25 min) - Core fix for relevance
4. **Update FTS with field weighting** (15 min) - Improves title matching
5. **Add trigram indexes** (10 min) - Enables fuzzy matching
6. **Add structured event parsing** (1 hour) - Long-term improvement
7. **Add observability** (15 min) - Debugging future issues

**Total estimated time**: ~2.5 hours

---

## 9. NEXT STEPS

1. Run vector dimension migration SQL
2. Re-embed all resources
3. Deploy search fixes (early-stop removal + reranking)
4. Test with user's 4 queries
5. Iterate based on logs

---

## APPENDIX: Key Files

- Upload: `src/app/api/upload/route.ts`
- Embeddings: `src/lib/embeddings.ts`
- Search V2: `src/lib/search-v2.ts`
- Answer composition: `src/lib/orchestrator/execute/answer.ts`
- DB schema: `database/core/schema.sql`
- FTS function: `database/fixes/fix-resource-created-by-type.sql` (lines 57-100)
- Vector function: `database/core/supabase-vector-function.sql`

