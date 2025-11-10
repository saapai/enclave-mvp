-- Migrate vector dimensions from 1024 to 1536 to match OpenAI text-embedding-3-small
-- Run this in your Supabase SQL editor

-- Step 1: Drop existing tables (this will delete all embeddings - they need to be regenerated)
DROP TABLE IF EXISTS resource_embedding CASCADE;
DROP TABLE IF EXISTS resource_chunk CASCADE;

-- Step 2: Recreate resource_embedding table with 1536 dimensions
CREATE TABLE resource_embedding (
  resource_id UUID PRIMARY KEY REFERENCES resource(id) ON DELETE CASCADE,
  embedding VECTOR(1536),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resource_embedding_vector_idx ON resource_embedding 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Step 3: Recreate resource_chunk table with 1536 dimensions
CREATE TABLE resource_chunk (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_id UUID REFERENCES resource(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resource_chunk_resource_idx ON resource_chunk (resource_id);
CREATE INDEX IF NOT EXISTS resource_chunk_index_idx ON resource_chunk (resource_id, chunk_index);
CREATE INDEX IF NOT EXISTS resource_chunk_vector_idx ON resource_chunk 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Step 4: Update search_resources_vector function to use 1536 dimensions
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

-- Step 5: Update search_resource_chunks_vector function to use 1536 dimensions
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

-- Step 6: Grant necessary permissions
GRANT SELECT ON resource_embedding TO authenticated;
GRANT SELECT ON resource_chunk TO authenticated;

-- Done! Now run: npx tsx scripts/reembed-with-1536-dims.ts
-- to regenerate all embeddings with the correct dimensions

