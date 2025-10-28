-- Fix app_user unique constraint to allow same email in different spaces
-- Run this in Supabase SQL Editor

-- 1. Drop the old unique constraint on email only
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_email_key;

-- 2. Add composite unique constraint on (email, space_id)
-- This allows same user to be in multiple spaces
ALTER TABLE app_user ADD CONSTRAINT app_user_email_space_key 
  UNIQUE (email, space_id);

-- 3. Add user_id column if it doesn't exist (for Clerk integration)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'app_user' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE app_user ADD COLUMN user_id TEXT;
  END IF;
END $$;

-- 4. Verify the schema
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'app_user'
ORDER BY ordinal_position;

-- 5. Verify constraints
SELECT
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'app_user'::regclass
ORDER BY conname;


