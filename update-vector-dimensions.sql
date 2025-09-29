-- Update vector dimensions from 1536 to 1024 to match Mistral embeddings
-- Run this in your Supabase SQL editor

-- Drop existing tables and recreate with correct dimensions
DROP TABLE IF EXISTS resource_embedding CASCADE;
DROP TABLE IF EXISTS resource_chunk CASCADE;

-- Recreate resource_embedding table with 1024 dimensions
CREATE TABLE resource_embedding (
  resource_id UUID PRIMARY KEY REFERENCES resource(id) ON DELETE CASCADE,
  embedding VECTOR(1024),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreate resource_chunk table with 1024 dimensions
CREATE TABLE resource_chunk (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_id UUID REFERENCES resource(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreate indexes
CREATE INDEX resource_chunk_resource_idx ON resource_chunk (resource_id);
CREATE INDEX resource_chunk_index_idx ON resource_chunk (resource_id, chunk_index);

-- Recreate vector search function with 1024 dimensions
CREATE OR REPLACE FUNCTION search_resources_vector(
  query_embedding float8[],
  target_space_id uuid,
  limit_count integer DEFAULT 20,
  offset_count integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  score float4
) AS $$
BEGIN
  RETURN QUERY
  SELECT r.id,
    (1 - (re.embedding <=> (query_embedding::vector(1024))))::float4 AS score
  FROM resource_embedding re
  JOIN resource r ON r.id = re.resource_id
  WHERE r.space_id = target_space_id
  ORDER BY re.embedding <=> (query_embedding::vector(1024)) ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Recreate chunk vector search function with 1024 dimensions
CREATE OR REPLACE FUNCTION search_resource_chunks_vector(
  query_embedding float8[],
  target_space_id uuid,
  limit_count integer DEFAULT 20,
  offset_count integer DEFAULT 0
)
RETURNS TABLE (
  resource_id uuid,
  chunk_index integer,
  score float4
) AS $$
BEGIN
  RETURN QUERY
  SELECT rc.resource_id,
         rc.chunk_index,
         (1 - (rc.embedding <=> (query_embedding::vector(1024))))::float4 AS score
  FROM resource_chunk rc
  JOIN resource r ON r.id = rc.resource_id
  WHERE r.space_id = target_space_id
    AND rc.embedding IS NOT NULL
  ORDER BY rc.embedding <=> (query_embedding::vector(1024)) ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;
