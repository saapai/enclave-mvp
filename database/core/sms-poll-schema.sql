-- SMS Poll Schema
-- Create tables to manage polls and responses for SMS blasts

CREATE TABLE IF NOT EXISTS sms_poll (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL,
  question TEXT NOT NULL,
  options JSONB NOT NULL, -- array of option labels, e.g. ["Yes","No","Maybe"]
  code TEXT NOT NULL UNIQUE, -- short code included in outbound SMS to disambiguate
  created_by TEXT NOT NULL, -- phone number or Clerk user ID
  status TEXT DEFAULT 'draft', -- draft, sent
  sent_at TIMESTAMPTZ,
  airtable_question_field TEXT, -- dynamic Airtable field name for this poll's question
  airtable_response_field TEXT, -- dynamic Airtable field name for responses
  airtable_notes_field TEXT, -- dynamic Airtable field name for notes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_poll_space_id_idx ON sms_poll (space_id);
CREATE INDEX IF NOT EXISTS sms_poll_code_idx ON sms_poll (code);
CREATE INDEX IF NOT EXISTS sms_poll_status_idx ON sms_poll (status);

CREATE TABLE IF NOT EXISTS sms_poll_response (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id UUID NOT NULL REFERENCES sms_poll(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  person_name TEXT, -- collected on first response
  option_index INTEGER NOT NULL, -- 0-based index into options (-1 = pending)
  option_label TEXT NOT NULL,
  notes TEXT, -- additional context like "running 15 late"
  response_status TEXT DEFAULT 'pending', -- pending, answered, needs_name
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(poll_id, phone)
);

CREATE INDEX IF NOT EXISTS sms_poll_response_poll_id_idx ON sms_poll_response (poll_id);
CREATE INDEX IF NOT EXISTS sms_poll_response_phone_idx ON sms_poll_response (phone);
CREATE INDEX IF NOT EXISTS sms_poll_response_status_idx ON sms_poll_response (response_status);

COMMENT ON TABLE sms_poll IS 'Polls sent via SMS to space members';
COMMENT ON TABLE sms_poll_response IS 'Responses to SMS polls by phone';


