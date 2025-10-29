-- SMS Conversation History Table
-- This table tracks conversation history for SMS users
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sms_conversation_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT NOT NULL,
  user_message TEXT NOT NULL,
  bot_response TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure isolation per phone number
  CONSTRAINT sms_conversation_history_phone_check CHECK (phone_number ~ '^[0-9]{10,15}$')
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS sms_conversation_history_phone_idx ON sms_conversation_history (phone_number);
CREATE INDEX IF NOT EXISTS sms_conversation_history_created_at_idx ON sms_conversation_history (created_at);

-- Comment on table
COMMENT ON TABLE sms_conversation_history IS 'Stores conversation history for SMS users to enable contextual responses';

