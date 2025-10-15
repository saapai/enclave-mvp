-- Fix vector search to include user filtering for default workspace
-- This ensures users only see their own resources in personal workspace
-- Run this in Supabase SQL Editor

-- Drop all existing versions of the function
DROP FUNCTION IF EXISTS search_resources_vector(vector, uuid, integer, integer, text);
DROP FUNCTION IF EXISTS search_resources_vector(vector, uuid, integer, integer);
DROP FUNCTION IF EXISTS search_resources_vector(float8[], uuid, integer, integer);

-- Create the updated search_resources_vector function with user filtering
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
    -- Filter by user for default workspace (personal), allow all for custom workspaces
    AND (target_space_id != '00000000-0000-0000-0000-000000000000' OR target_user_id IS NULL OR r.created_by = target_user_id)
  ORDER BY re.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Test the function (should return only user's own resources for default workspace)
-- SELECT * FROM search_resources_vector(
--   (SELECT embedding FROM resource_embedding LIMIT 1),
--   '00000000-0000-0000-0000-000000000000',
--   10,
--   0,
--   'user_345gIKBpm7EpflDg5nayG4kvT8D'
-- );
