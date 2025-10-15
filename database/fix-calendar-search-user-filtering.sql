-- Fix calendar search to include user filtering for default workspace
-- This ensures users only see their own calendar events in personal workspace
-- Run this in Supabase SQL Editor

-- Drop and recreate the search_calendar_events_vector function with user filtering
DROP FUNCTION IF EXISTS search_calendar_events_vector(vector, uuid, integer, integer, text);
DROP FUNCTION IF EXISTS search_calendar_events_vector(vector, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_calendar_events_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0,
  target_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_id UUID,
  summary TEXT,
  description TEXT,
  location TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  html_link TEXT,
  added_by TEXT,
  similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ce.id,
    ce.source_id,
    ce.summary,
    ce.description,
    ce.location,
    ce.start_time,
    ce.end_time,
    ce.html_link,
    sgc.added_by,
    1 - (ce.embedding <=> query_embedding) AS similarity
  FROM calendar_events ce
  JOIN sources_google_calendar sgc ON ce.source_id = sgc.id
  WHERE ce.space_id = target_space_id
    AND ce.start_time >= NOW() - INTERVAL '7 days'  -- Only future and recent past events
    -- Filter by user for default workspace (personal), allow all for custom workspaces
    AND (target_space_id != '00000000-0000-0000-0000-000000000000' OR target_user_id IS NULL OR sgc.added_by = target_user_id)
  ORDER BY ce.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
