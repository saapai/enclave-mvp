-- Migration to update Slack schema for dual token support
-- Run this after the existing slack-schema.sql

-- Add new token columns if they don't exist
ALTER TABLE slack_accounts 
ADD COLUMN IF NOT EXISTS bot_token TEXT,
ADD COLUMN IF NOT EXISTS user_token TEXT;

-- Migrate existing access_token to bot_token
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'slack_accounts' AND column_name = 'access_token'
  ) THEN
    -- Copy access_token to bot_token where bot_token is NULL
    UPDATE slack_accounts 
    SET bot_token = access_token 
    WHERE bot_token IS NULL AND access_token IS NOT NULL;
    
    -- Drop the old access_token column
    ALTER TABLE slack_accounts DROP COLUMN access_token;
  END IF;
END $$;

-- Make sure both token columns are NOT NULL (after migration)
ALTER TABLE slack_accounts ALTER COLUMN bot_token SET NOT NULL;
ALTER TABLE slack_accounts ALTER COLUMN user_token SET NOT NULL;
