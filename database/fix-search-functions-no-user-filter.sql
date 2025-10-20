-- 🔧 Fix search functions to not filter by user
-- This allows any workspace member to search all resources in that workspace

-- 1. Fix search_resources_vector function
DROP FUNCTION IF EXISTS search_resources_vector(vector, uuid, integer, integer, text);

CREATE OR REPLACE FUNCTION search_resources_vector(
  query_embedding VECTOR(1024),
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
    -- Removed user filtering - any workspace member can search all resources
  ORDER BY re.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Fix search_google_docs_vector function
DROP FUNCTION IF EXISTS search_google_docs_vector(vector, uuid, integer, integer, text);

CREATE OR REPLACE FUNCTION search_google_docs_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0,
  target_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  chunk_id UUID,
  text TEXT,
  similarity FLOAT8,
  added_by TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gdc.id,
    gdc.chunk_id,
    gdc.text,
    (1 - (gdc.embedding <=> query_embedding))::FLOAT8 AS similarity,
    gdc.added_by
  FROM google_docs_chunks gdc
  WHERE gdc.space_id = target_space_id
    AND gdc.embedding IS NOT NULL
    -- Removed user filtering - any workspace member can search all Google Doc chunks
  ORDER BY gdc.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Fix search_calendar_events_vector function
DROP FUNCTION IF EXISTS search_calendar_events_vector(vector, uuid, integer, integer, text);

CREATE OR REPLACE FUNCTION search_calendar_events_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0,
  target_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  event_id UUID,
  text TEXT,
  similarity FLOAT8,
  added_by TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cec.id,
    cec.event_id,
    cec.text,
    (1 - (cec.embedding <=> query_embedding))::FLOAT8 AS similarity,
    cec.added_by
  FROM calendar_events_chunks cec
  WHERE cec.space_id = target_space_id
    AND cec.embedding IS NOT NULL
    -- Removed user filtering - any workspace member can search all calendar events
  ORDER BY cec.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify functions were updated
SELECT 
  'Functions updated' as status,
  COUNT(*) as function_count
FROM pg_proc 
WHERE proname IN (
  'search_resources_vector',
  'search_google_docs_vector', 
  'search_calendar_events_vector'
);

