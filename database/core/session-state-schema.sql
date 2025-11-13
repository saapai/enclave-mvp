-- Session State Table
-- Stores conversation state for each phone number
-- This is the single source of truth for draft state, mode, etc.

CREATE TABLE IF NOT EXISTS sms_session_state (
  phone TEXT PRIMARY KEY,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sms_session_state_updated 
  ON sms_session_state(updated_at DESC);

-- RLS policies
ALTER TABLE sms_session_state ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to session state"
  ON sms_session_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE sms_session_state IS 'Stores conversation session state for SMS bot interactions';
COMMENT ON COLUMN sms_session_state.phone IS 'Phone number (normalized, no +1 prefix)';
COMMENT ON COLUMN sms_session_state.state_json IS 'JSON blob containing SessionState (mode, draft, history_window_ids)';



