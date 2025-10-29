-- Fix Knowledge Graph Functions
-- Run this in Supabase SQL Editor to fix the ORDER BY error

-- Function to get event by name or alias (FIXED)
CREATE OR REPLACE FUNCTION find_event_by_name(
  search_name TEXT,
  target_space_id UUID
)
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  location TEXT,
  match_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH direct_matches AS (
    -- Direct name match
    SELECT 
      e.id,
      e.name,
      e.start_at,
      e.end_at,
      e.location,
      'direct'::TEXT as match_type
    FROM event e
    WHERE e.space_id = target_space_id
      AND e.name ILIKE '%' || search_name || '%'
  ),
  alias_matches AS (
    -- Alias match
    SELECT 
      e.id,
      e.name,
      e.start_at,
      e.end_at,
      e.location,
      'alias'::TEXT as match_type
    FROM event e
    JOIN event_alias ea ON ea.event_id = e.id
    WHERE e.space_id = target_space_id
      AND ea.alias ILIKE '%' || search_name || '%'
  )
  SELECT * FROM direct_matches
  UNION ALL
  SELECT * FROM alias_matches
  ORDER BY match_type, event_name
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

