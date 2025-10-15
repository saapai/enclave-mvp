-- Fix RLS policies for Google Calendar tables
-- The issue is that auth.uid() returns UUID but added_by is TEXT (for Clerk IDs)

-- Drop existing policies
DROP POLICY IF EXISTS "Users can access google calendars in their spaces" ON sources_google_calendar;
DROP POLICY IF EXISTS "Users can access calendar events in their spaces" ON calendar_events;

-- Recreate with proper type casting
CREATE POLICY "Users can access google calendars in their spaces" ON sources_google_calendar
  FOR ALL USING (
    space_id = '00000000-0000-0000-0000-000000000000' OR
    added_by = auth.uid()::text
  );

CREATE POLICY "Users can access calendar events in their spaces" ON calendar_events
  FOR ALL USING (
    space_id = '00000000-0000-0000-0000-000000000000' OR
    source_id IN (
      SELECT id FROM sources_google_calendar WHERE added_by = auth.uid()::text
    )
  );


