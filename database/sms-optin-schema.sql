-- SMS Opt-In Table
-- This table stores user consent information for SMS messaging

CREATE TABLE IF NOT EXISTS sms_optin (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  method TEXT CHECK (method IN ('web_form', 'sms_keyword')) NOT NULL,
  keyword TEXT, -- The keyword used if method is 'sms_keyword' (START, JOIN, YES, etc.)
  ip_address TEXT, -- IP address for web form submissions
  consent_timestamp TIMESTAMPTZ DEFAULT NOW(),
  opted_out BOOLEAN DEFAULT FALSE,
  opted_out_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS sms_optin_phone_idx ON sms_optin (phone);
CREATE INDEX IF NOT EXISTS sms_optin_opted_out_idx ON sms_optin (opted_out);
CREATE INDEX IF NOT EXISTS sms_optin_consent_timestamp_idx ON sms_optin (consent_timestamp);

-- SMS Message Log Table
-- This table logs all SMS messages sent
CREATE TABLE IF NOT EXISTS sms_message_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT CHECK (status IN ('sent', 'delivered', 'failed', 'queued')) DEFAULT 'queued',
  twilio_sid TEXT, -- Twilio message SID for tracking
  error_message TEXT, -- Error message if delivery failed
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for message log
CREATE INDEX IF NOT EXISTS sms_message_log_phone_idx ON sms_message_log (phone);
CREATE INDEX IF NOT EXISTS sms_message_log_status_idx ON sms_message_log (status);
CREATE INDEX IF NOT EXISTS sms_message_log_sent_at_idx ON sms_message_log (sent_at);

-- Function to handle opt-out
CREATE OR REPLACE FUNCTION handle_sms_optout(phone_number TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE sms_optin
  SET opted_out = TRUE,
      opted_out_timestamp = NOW(),
      updated_at = NOW()
  WHERE phone = phone_number;
END;
$$ LANGUAGE plpgsql;

-- Comment on tables
COMMENT ON TABLE sms_optin IS 'Stores SMS opt-in consent information for Twilio messaging compliance';
COMMENT ON TABLE sms_message_log IS 'Logs all SMS messages sent through the system for auditing and compliance';



