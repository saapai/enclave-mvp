# 🚨 URGENT: Database Migration Required

## Problem
Your database is configured for **1024-dimension vectors** but the code is now sending **1536-dimension embeddings**. This mismatch is causing:
- Queries taking 11-61 seconds (should be <1s)
- First query never responding
- Watchdog timeouts
- AbortErrors

## Solution: Run This SQL Migration NOW

### Step 1: Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click "SQL Editor" in the left sidebar
4. Click "New Query"

### Step 2: Copy and Paste This SQL

```sql
-- Migrate vector dimensions from 1024 to 1536
-- This will DELETE all existing embeddings (they need to be regenerated)

BEGIN;

-- Drop existing tables
DROP TABLE IF EXISTS resource_embedding CASCADE;
DROP TABLE IF EXISTS resource_chunk CASCADE;

-- Recreate resource_embedding with 1536 dimensions
CREATE TABLE resource_embedding (
  resource_id UUID PRIMARY KEY REFERENCES resource(id) ON DELETE CASCADE,
  embedding VECTOR(1536),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX resource_embedding_vector_idx ON resource_embedding 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Recreate resource_chunk with 1536 dimensions
CREATE TABLE resource_chunk (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_id UUID REFERENCES resource(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX resource_chunk_resource_idx ON resource_chunk (resource_id);
CREATE INDEX resource_chunk_index_idx ON resource_chunk (resource_id, chunk_index);
CREATE INDEX resource_chunk_vector_idx ON resource_chunk 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Update search_resources_vector function
DROP FUNCTION IF EXISTS search_resources_vector(vector, uuid, integer, integer, text);
DROP FUNCTION IF EXISTS search_resources_vector(vector, uuid, integer, integer);
DROP FUNCTION IF EXISTS search_resources_vector(float8[], uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_resources_vector(
  query_embedding VECTOR(1536),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0,
  target_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  space_id UUID,
  type TEXT,
  title TEXT,
  body TEXT,
  url TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  similarity FLOAT8
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.space_id,
    r.type,
    r.title,
    r.body,
    r.url,
    r.created_by,
    r.created_at,
    r.updated_at,
    (1 - (re.embedding <=> query_embedding))::FLOAT8 AS similarity
  FROM resource_embedding re
  JOIN resource r ON r.id = re.resource_id
  WHERE r.space_id = target_space_id
    AND re.embedding IS NOT NULL
  ORDER BY re.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update search_resource_chunks_vector function
DROP FUNCTION IF EXISTS search_resource_chunks_vector(vector, uuid, integer, integer);
DROP FUNCTION IF EXISTS search_resource_chunks_vector(float8[], uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_resource_chunks_vector(
  query_embedding VECTOR(1536),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  resource_id UUID,
  chunk_index INTEGER,
  chunk_text TEXT,
  score FLOAT4
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rc.resource_id,
    rc.chunk_index,
    rc.chunk_text,
    (1 - (rc.embedding <=> query_embedding))::FLOAT4 AS score
  FROM resource_chunk rc
  JOIN resource r ON r.id = rc.resource_id
  WHERE r.space_id = target_space_id
    AND rc.embedding IS NOT NULL
  ORDER BY rc.embedding <=> query_embedding ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant permissions
GRANT SELECT ON resource_embedding TO authenticated;
GRANT SELECT ON resource_chunk TO authenticated;

COMMIT;
```

### Step 3: Click "Run" (or press Cmd/Ctrl + Enter)

You should see: `Success. No rows returned.`

### Step 4: Re-generate Embeddings

After the migration, run this command locally:

```bash
cd /Users/gopalakrishnapai/Documents/enclave/enclave-mvp
source .env.local
npx tsx scripts/reembed-with-1536-dims.ts
```

This will regenerate all embeddings with the correct 1536 dimensions.

## Expected Results After Migration

✅ Queries complete in **<200ms** (not 11-61 seconds)
✅ First query responds immediately
✅ No watchdog timeouts
✅ Vector search works with semantic matching
✅ Chunks are properly searched

## Why This Happened

1. Database was originally set to 1024 dimensions (Mistral)
2. Code was updated to use OpenAI's native 1536 dimensions
3. Dimension mismatch caused database queries to hang/fail
4. Lexical search still works (doesn't use embeddings) but is slow

## Timeline

- **Before migration**: 11-61 second queries, first query fails
- **After migration + re-embedding**: <200ms queries, all queries work

---

**DO THIS NOW** before testing any more queries!

