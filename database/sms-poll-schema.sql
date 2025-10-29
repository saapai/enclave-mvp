-- SMS Poll Schema
-- Create tables to manage polls and responses for SMS blasts

CREATE TABLE IF NOT EXISTS sms_poll (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL,
  question TEXT NOT NULL,
  options JSONB NOT NULL, -- array of option labels, e.g. ["Yes","No","Maybe"]
  code TEXT NOT NULL UNIQUE, -- short code included in outbound SMS to disambiguate
  created_by TEXT NOT NULL, -- Clerk user ID
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_poll_space_id_idx ON sms_poll (space_id);
CREATE INDEX IF NOT EXISTS sms_poll_code_idx ON sms_poll (code);

CREATE TABLE IF NOT EXISTS sms_poll_response (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id UUID NOT NULL REFERENCES sms_poll(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  option_index INTEGER NOT NULL, -- 0-based index into options
  option_label TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(poll_id, phone)
);

CREATE INDEX IF NOT EXISTS sms_poll_response_poll_id_idx ON sms_poll_response (poll_id);
CREATE INDEX IF NOT EXISTS sms_poll_response_phone_idx ON sms_poll_response (phone);

COMMENT ON TABLE sms_poll IS 'Polls sent via SMS to space members';
COMMENT ON TABLE sms_poll_response IS 'Responses to SMS polls by phone';


