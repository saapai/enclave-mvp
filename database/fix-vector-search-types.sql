-- Fix vector search function return type mismatches
-- Run this in your Supabase SQL editor

-- Fix search_google_docs_vector to return FLOAT8 (double precision) instead of REAL
DROP FUNCTION IF EXISTS search_google_docs_vector(vector, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_google_docs_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  source_id UUID,
  heading_path TEXT[],
  text TEXT,
  metadata JSONB,
  similarity FLOAT8
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gdc.id,
    gdc.source_id,
    gdc.heading_path,
    gdc.text,
    gdc.metadata,
    (1 - (gdc.embedding <=> query_embedding))::FLOAT8 AS similarity
  FROM google_doc_chunks gdc
  WHERE gdc.space_id = target_space_id
    AND gdc.embedding IS NOT NULL
  ORDER BY gdc.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Also fix the regular search_resources_vector function if it exists
DROP FUNCTION IF EXISTS search_resources_vector(vector, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_resources_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  body TEXT,
  url TEXT,
  type TEXT,
  space_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by UUID,
  similarity FLOAT8
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    re.id,
    re.title,
    re.body,
    re.url,
    re.type,
    re.space_id,
    re.created_at,
    re.updated_at,
    re.created_by,
    (1 - (re.embedding <=> query_embedding))::FLOAT8 AS similarity
  FROM resource_embedding re
  WHERE re.space_id = target_space_id
    AND re.embedding IS NOT NULL
  ORDER BY re.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;




