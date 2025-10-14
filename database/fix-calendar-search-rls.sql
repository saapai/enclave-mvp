-- Fix Calendar Events RLS to match new user-specific model
-- This ensures calendar events are only visible to users who added them

-- Update calendar events RLS
DROP POLICY IF EXISTS "Users can access calendar events in their spaces" ON calendar_events;
DROP POLICY IF EXISTS "Users can access own calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Users can insert own calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Users can view own calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Users can modify own calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Users can delete own calendar events" ON calendar_events;

-- Separate policies for different operations
CREATE POLICY "Users can view own calendar events" ON calendar_events
  FOR SELECT
  USING (
    source_id IN (
      SELECT id FROM sources_google_calendar WHERE added_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Users can insert own calendar events" ON calendar_events
  FOR INSERT
  WITH CHECK (
    source_id IN (
      SELECT id FROM sources_google_calendar WHERE added_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Users can modify own calendar events" ON calendar_events
  FOR UPDATE
  USING (
    source_id IN (
      SELECT id FROM sources_google_calendar WHERE added_by::text = auth.uid()::text
    )
  )
  WITH CHECK (
    source_id IN (
      SELECT id FROM sources_google_calendar WHERE added_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Users can delete own calendar events" ON calendar_events
  FOR DELETE
  USING (
    source_id IN (
      SELECT id FROM sources_google_calendar WHERE added_by::text = auth.uid()::text
    )
  );

-- Update sources_google_calendar RLS
DROP POLICY IF EXISTS "Users can access calendars in their spaces" ON sources_google_calendar;
DROP POLICY IF EXISTS "Users can access own calendar sources" ON sources_google_calendar;
DROP POLICY IF EXISTS "Users can view own calendar sources" ON sources_google_calendar;
DROP POLICY IF EXISTS "Users can insert own calendar sources" ON sources_google_calendar;
DROP POLICY IF EXISTS "Users can modify own calendar sources" ON sources_google_calendar;
DROP POLICY IF EXISTS "Users can delete own calendar sources" ON sources_google_calendar;

-- Separate policies for different operations
CREATE POLICY "Users can view own calendar sources" ON sources_google_calendar
  FOR SELECT
  USING (added_by::text = auth.uid()::text);

CREATE POLICY "Users can insert own calendar sources" ON sources_google_calendar
  FOR INSERT
  WITH CHECK (added_by::text = auth.uid()::text);

CREATE POLICY "Users can modify own calendar sources" ON sources_google_calendar
  FOR UPDATE
  USING (added_by::text = auth.uid()::text)
  WITH CHECK (added_by::text = auth.uid()::text);

CREATE POLICY "Users can delete own calendar sources" ON sources_google_calendar
  FOR DELETE
  USING (added_by::text = auth.uid()::text);

-- Update search_calendar_events_vector function to filter by user
DROP FUNCTION IF EXISTS search_calendar_events_vector(vector, uuid, integer, integer);
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
    AND (target_user_id IS NULL OR scs.added_by::text = target_user_id)  -- Filter by user if provided
  ORDER BY ce.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

