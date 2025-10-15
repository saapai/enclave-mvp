-- Fix FTS search to work properly with manual uploads and Clerk auth
-- This removes auth.uid() filtering which doesn't work with Clerk
-- Run this in Supabase SQL Editor

-- Drop and recreate the search_resources_fts function without auth.uid() filtering
DROP FUNCTION IF EXISTS search_resources_fts(text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_resources_fts(
  search_query TEXT,
  target_space_id UUID,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
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
  rank REAL
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
    ts_rank(
      to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, '')),
      plainto_tsquery('english', search_query)
    ) AS rank
  FROM resource r
  WHERE r.space_id = target_space_id
    AND to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, ''))
        @@ plainto_tsquery('english', search_query)
    -- No user filtering here - handled at application level with Clerk auth
  ORDER BY rank DESC, r.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Test the function (should return your resume)
-- SELECT * FROM search_resources_fts('resume', '00000000-0000-0000-0000-000000000000', 10, 0);

