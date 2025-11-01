-- SMS Query Session Table
-- This table tracks active SMS query sessions for users
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sms_query_session (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT NOT NULL,
  status TEXT CHECK (status IN ('active', 'inactive', 'expired')) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS sms_query_session_phone_idx ON sms_query_session (phone_number);
CREATE INDEX IF NOT EXISTS sms_query_session_status_idx ON sms_query_session (status);

-- Add expiration to sessions (inactive sessions older than 24 hours)
CREATE OR REPLACE FUNCTION expire_sms_query_sessions()
RETURNS VOID AS $$
BEGIN
  UPDATE sms_query_session
  SET status = 'expired',
      updated_at = NOW()
  WHERE status = 'inactive'
    AND updated_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Comment on table
COMMENT ON TABLE sms_query_session IS 'Tracks active SMS query sessions for phone-to-user mapping';

