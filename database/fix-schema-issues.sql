-- Fix database schema issues
-- Run this in your Supabase SQL editor

-- Fix query_log table to allow nullable user_id for now
ALTER TABLE query_log ALTER COLUMN user_id DROP NOT NULL;

-- Add missing tables if they don't exist
CREATE TABLE IF NOT EXISTS resource_chunk (
  id BIGSERIAL PRIMARY KEY,
  resource_id UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resource_embedding (
  resource_id UUID PRIMARY KEY REFERENCES resource(id) ON DELETE CASCADE,
  embedding VECTOR(1024) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for the new tables
CREATE INDEX IF NOT EXISTS idx_resource_chunk_resource_id ON resource_chunk(resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_chunk_index ON resource_chunk(resource_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_resource_embedding_updated_at ON resource_embedding(updated_at);

-- Add vector similarity search index for resource_chunk
CREATE INDEX IF NOT EXISTS idx_resource_chunk_embedding ON resource_chunk 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Add vector similarity search index for resource_embedding
CREATE INDEX IF NOT EXISTS idx_resource_embedding_ivfflat ON resource_embedding 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Update the search_resources_vector function to work with the new table structure
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
    -- Convert cosine distance to similarity (1 - distance)
    (1 - (re.embedding <=> (query_embedding::vector(1024))))::float4 AS score
  FROM resource_embedding re
  JOIN resource r ON r.id = re.resource_id
  WHERE r.space_id = target_space_id
  ORDER BY re.embedding <=> (query_embedding::vector(1024)) ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create a function to search resource chunks
CREATE OR REPLACE FUNCTION search_resource_chunks_vector(
  query_embedding float8[],
  target_space_id uuid,
  limit_count integer DEFAULT 20,
  offset_count integer DEFAULT 0
)
RETURNS TABLE (
  id bigint,
  resource_id uuid,
  chunk_text text,
  score float4
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rc.id,
    rc.resource_id,
    rc.chunk_text,
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