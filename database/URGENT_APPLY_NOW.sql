-- URGENT: Apply this SQL to fix hanging FTS queries
-- This adds server-side timeouts to prevent queries from running longer than 500ms

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
  -- CRITICAL: Set server-side timeout to prevent hanging queries
  PERFORM set_config('statement_timeout', '500ms', true);
  PERFORM set_config('idle_in_transaction_session_timeout', '1000ms', true);
  
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
    (
      -- Title weight: 3.0 (much higher priority)
      ts_rank(
        to_tsvector('english', coalesce(r.title, '')),
        plainto_tsquery('english', search_query)
      ) * 3.0
      +
      -- Body weight: 1.0 (baseline)
      ts_rank(
        to_tsvector('english', coalesce(r.body, '')),
        plainto_tsquery('english', search_query)
      ) * 1.0
      +
      -- Type boost: events are more likely to be queried
      CASE r.type
        WHEN 'event' THEN 0.2
        WHEN 'faq' THEN 0.15
        ELSE 0.0
      END
    )::REAL AS rank
  FROM resource r
  WHERE r.space_id = target_space_id
    AND (
      to_tsvector('english', coalesce(r.title, '')) @@ plainto_tsquery('english', search_query)
      OR
      to_tsvector('english', coalesce(r.body, '')) @@ plainto_tsquery('english', search_query)
    )
  ORDER BY rank DESC, r.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify the function was updated
SELECT 
  routine_name,
  routine_definition
FROM information_schema.routines
WHERE routine_name = 'search_resources_fts'
  AND routine_schema = 'public';

