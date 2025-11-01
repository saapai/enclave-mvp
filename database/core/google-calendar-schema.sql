-- Google Calendar integration schema
-- Run this in your Supabase SQL editor

-- Google Calendar sources
CREATE TABLE sources_google_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  calendar_id TEXT NOT NULL,
  calendar_name TEXT,
  calendar_description TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  added_by TEXT NOT NULL,  -- Clerk user ID
  last_synced TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id, calendar_id)
);

-- Calendar events
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  source_id UUID NOT NULL REFERENCES sources_google_calendar(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  is_all_day BOOLEAN DEFAULT FALSE,
  attendees JSONB DEFAULT '[]',
  html_link TEXT,
  status TEXT,
  organizer JSONB,
  recurring_event_id TEXT,
  embedding VECTOR(1024),  -- Mistral embedding dimension
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, event_id)
);

-- Indexes for performance
CREATE INDEX idx_sources_google_calendar_space_id ON sources_google_calendar(space_id);
CREATE INDEX idx_sources_google_calendar_added_by ON sources_google_calendar(added_by);
CREATE INDEX idx_calendar_events_space_id ON calendar_events(space_id);
CREATE INDEX idx_calendar_events_source_id ON calendar_events(source_id);
CREATE INDEX idx_calendar_events_start_time ON calendar_events(start_time);
CREATE INDEX idx_calendar_events_embedding ON calendar_events USING ivfflat (embedding vector_cosine_ops);

-- RLS policies
ALTER TABLE sources_google_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Calendar sources: users can access calendars in their spaces
CREATE POLICY "Users can access google calendars in their spaces" ON sources_google_calendar
  FOR ALL USING (
    space_id = '00000000-0000-0000-0000-000000000000' OR
    added_by = auth.uid()::text
  );

-- Calendar events: users can access events in their spaces
CREATE POLICY "Users can access calendar events in their spaces" ON calendar_events
  FOR ALL USING (
    space_id = '00000000-0000-0000-0000-000000000000' OR
    source_id IN (
      SELECT id FROM sources_google_calendar WHERE added_by = auth.uid()::text
    )
  );

-- Functions for Google Calendar integration
CREATE OR REPLACE FUNCTION search_calendar_events_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0
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
    1 - (ce.embedding <=> query_embedding) AS similarity
  FROM calendar_events ce
  WHERE ce.space_id = target_space_id
    AND ce.start_time >= NOW() - INTERVAL '7 days'  -- Only future and recent past events
  ORDER BY ce.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get upcoming events
CREATE OR REPLACE FUNCTION get_upcoming_events(
  target_space_id UUID,
  days_ahead INTEGER DEFAULT 30,
  limit_count INTEGER DEFAULT 50
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
  is_all_day BOOLEAN
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
    ce.is_all_day
  FROM calendar_events ce
  WHERE ce.space_id = target_space_id
    AND ce.start_time >= NOW()
    AND ce.start_time <= NOW() + (days_ahead || ' days')::INTERVAL
    AND ce.status != 'cancelled'
  ORDER BY ce.start_time ASC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to search calendar events by text
CREATE OR REPLACE FUNCTION search_calendar_events_text(
  search_query TEXT,
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0
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
  rank REAL
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
    ts_rank(
      to_tsvector('english', coalesce(ce.summary, '') || ' ' || coalesce(ce.description, '') || ' ' || coalesce(ce.location, '')),
      plainto_tsquery('english', search_query)
    ) AS rank
  FROM calendar_events ce
  WHERE ce.space_id = target_space_id
    AND ce.start_time >= NOW() - INTERVAL '7 days'
    AND to_tsvector('english', coalesce(ce.summary, '') || ' ' || coalesce(ce.description, '') || ' ' || coalesce(ce.location, ''))
        @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC, ce.start_time ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

