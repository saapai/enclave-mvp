-- Fix search_resources_vector to properly join with resource table and filter by user
-- Run this in Supabase SQL Editor

DROP FUNCTION IF EXISTS search_resources_vector(vector, uuid, integer, integer, text);
DROP FUNCTION IF EXISTS search_resources_vector(vector, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_resources_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0,
  target_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  body TEXT,
  url TEXT,
  type TEXT,
  source TEXT,
  space_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by TEXT,
  similarity FLOAT8
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.title,
    r.body,
    r.url,
    r.type,
    r.source,
    r.space_id,
    r.created_at,
    r.updated_at,
    r.created_by,
    (1 - (re.embedding <=> query_embedding))::FLOAT8 AS similarity
  FROM resource_embedding re
  JOIN resource r ON r.id = re.resource_id
  WHERE r.space_id = target_space_id
    AND re.embedding IS NOT NULL
    AND (target_user_id IS NULL OR r.created_by = target_user_id)
  ORDER BY re.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Test the function
-- SELECT * FROM search_resources_vector(
--   (SELECT embedding FROM resource_embedding LIMIT 1),
--   '00000000-0000-0000-0000-000000000000',
--   10,
--   0,
--   'user_33FxuB70xSx3zkgm3I4W7tHMb0P'
-- );


