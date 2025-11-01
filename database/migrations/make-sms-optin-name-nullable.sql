-- Make name column nullable in sms_optin table
-- This allows us to create opt-in records before we collect the user's name
-- We'll track users who need names via the needs_name flag

ALTER TABLE sms_optin 
ALTER COLUMN name DROP NOT NULL;

-- Set needs_name = true for any existing rows with NULL names
UPDATE sms_optin
SET needs_name = true
WHERE name IS NULL;

COMMENT ON COLUMN sms_optin.name IS 'User name (nullable - may be collected later)';

