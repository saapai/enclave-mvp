-- Fix Calendar Events RLS to match new user-specific model
-- This ensures calendar events are only visible to users who added them

-- Update calendar events RLS
DROP POLICY IF EXISTS "Users can access calendar events in their spaces" ON calendar_events;

CREATE POLICY "Users can access own calendar events" ON calendar_events
  FOR ALL 
  USING (
    source_id IN (
      SELECT id FROM sources_google_calendar WHERE added_by::text = auth.uid()::text
    )
  );

-- Update search_calendar_events_vector function to filter by user
DROP FUNCTION IF EXISTS search_calendar_events_vector(vector, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_calendar_events_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  google_event_id TEXT,
  source_id UUID,
  title TEXT,
  description TEXT,
  location TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  attendees JSONB,
  html_link TEXT,
  similarity FLOAT8,
  added_by TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ce.id,
    ce.event_id AS google_event_id,
    ce.source_id,
    ce.summary AS title,
    ce.description,
    ce.location,
    ce.start_time,
    ce.end_time,
    ce.attendees,
    ce.html_link,
    (1 - (ce.embedding <=> query_embedding))::FLOAT8 AS similarity,
    scs.added_by,
    ce.created_at,
    ce.updated_at
  FROM calendar_events ce
  JOIN sources_google_calendar scs ON ce.source_id = scs.id
  WHERE ce.space_id = target_space_id
    AND scs.added_by::text = auth.uid()::text  -- CRITICAL: Filter by user
  ORDER BY ce.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

