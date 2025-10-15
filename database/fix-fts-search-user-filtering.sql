-- Fix FTS search to include user filtering for default workspace
-- This ensures users only see their own resources in personal workspace
-- Run this in Supabase SQL Editor

-- Drop and recreate the search_resources_fts function with user filtering
DROP FUNCTION IF EXISTS search_resources_fts(text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_resources_fts(
  search_query TEXT,
  target_space_id UUID,
  limit_count INTEGER DEFAULT 20,
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
    -- Filter by user for default workspace (personal), allow all for custom workspaces
    AND (target_space_id != '00000000-0000-0000-0000-000000000000' OR target_user_id IS NULL OR r.created_by = target_user_id)
  ORDER BY rank DESC, r.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
