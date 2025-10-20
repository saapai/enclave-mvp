-- Add timezone fields to calendar_events table
-- This preserves the original timezone from Google Calendar for proper display

ALTER TABLE calendar_events 
ADD COLUMN IF NOT EXISTS start_timezone TEXT,
ADD COLUMN IF NOT EXISTS end_timezone TEXT;

-- Add comment explaining the fields
COMMENT ON COLUMN calendar_events.start_timezone IS 'IANA timezone identifier (e.g., America/Los_Angeles) from Google Calendar API';
COMMENT ON COLUMN calendar_events.end_timezone IS 'IANA timezone identifier (e.g., America/Los_Angeles) from Google Calendar API';



