-- Add needs_name column to sms_optin table
-- This tracks whether we still need to collect the user's name

ALTER TABLE sms_optin 
ADD COLUMN IF NOT EXISTS needs_name BOOLEAN DEFAULT false;

-- For existing users who have no name (name is NULL or equals phone number), set needs_name to true
UPDATE sms_optin
SET needs_name = true
WHERE name IS NULL OR name = phone;

COMMENT ON COLUMN sms_optin.needs_name IS 'Whether we still need to collect the user''s name on their next message';

