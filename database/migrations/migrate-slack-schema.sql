-- Migration to update Slack schema for dual token support
-- Run this to migrate existing slack_accounts table

-- Step 1: Add new token columns if they don't exist
ALTER TABLE slack_accounts 
ADD COLUMN IF NOT EXISTS bot_token TEXT,
ADD COLUMN IF NOT EXISTS user_token TEXT;

-- Step 2: Migrate existing access_token to bot_token
DO $$
BEGIN
  -- Check if access_token column exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'slack_accounts' AND column_name = 'access_token'
  ) THEN
    -- Copy access_token to bot_token where bot_token is NULL
    UPDATE slack_accounts 
    SET bot_token = access_token 
    WHERE bot_token IS NULL AND access_token IS NOT NULL;
    
    -- For now, copy the same token to user_token as a temporary measure
    -- This will be updated when users reconnect with proper dual tokens
    UPDATE slack_accounts 
    SET user_token = access_token 
    WHERE user_token IS NULL AND access_token IS NOT NULL;
    
    -- Drop the old access_token column
    ALTER TABLE slack_accounts DROP COLUMN access_token;
  END IF;
END $$;

-- Step 3: Make columns NOT NULL only if they have data
DO $$
BEGIN
  -- Only make NOT NULL if we have data in the columns
  IF EXISTS (SELECT 1 FROM slack_accounts WHERE bot_token IS NOT NULL) THEN
    ALTER TABLE slack_accounts ALTER COLUMN bot_token SET NOT NULL;
  END IF;
  
  IF EXISTS (SELECT 1 FROM slack_accounts WHERE user_token IS NOT NULL) THEN
    ALTER TABLE slack_accounts ALTER COLUMN user_token SET NOT NULL;
  END IF;
END $$;
