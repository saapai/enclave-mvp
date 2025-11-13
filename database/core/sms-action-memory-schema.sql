-- SMS Action Memory Table
-- Tracks recent actions so the bot can answer questions about what it did
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sms_action_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('query', 'announcement_sent', 'poll_sent', 'poll_response_recorded', 'draft_created', 'draft_updated')),
  action_details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS sms_action_memory_phone_idx ON sms_action_memory (phone);
CREATE INDEX IF NOT EXISTS sms_action_memory_created_at_idx ON sms_action_memory (created_at DESC);
CREATE INDEX IF NOT EXISTS sms_action_memory_type_idx ON sms_action_memory (action_type);

-- Auto-cleanup old actions (keep last 50 per phone)
CREATE OR REPLACE FUNCTION cleanup_old_action_memory()
RETURNS VOID AS $$
BEGIN
  DELETE FROM sms_action_memory
  WHERE id NOT IN (
    SELECT id FROM sms_action_memory
    ORDER BY created_at DESC
    LIMIT 50
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE sms_action_memory IS 'Stores recent actions for SMS users to enable contextual responses about past actions';



