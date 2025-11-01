-- Fix space table to add created_by column and proper RLS policies
-- Run this in Supabase SQL Editor

-- 1. Add created_by column to space table
ALTER TABLE space ADD COLUMN created_by TEXT;

-- 2. Update existing default space to have a creator (optional)
UPDATE space SET created_by = 'system' WHERE id = '00000000-0000-0000-0000-000000000000';

-- 3. Drop existing policies
DROP POLICY IF EXISTS "Users can view their spaces" ON space;
DROP POLICY IF EXISTS "Users can create spaces" ON space;
DROP POLICY IF EXISTS "Users can update their spaces" ON space;
DROP POLICY IF EXISTS "Users can delete their spaces" ON space;

-- 4. Enable RLS on space table
ALTER TABLE space ENABLE ROW LEVEL SECURITY;

-- 5. Allow users to insert new spaces (created_by will be set by app)
CREATE POLICY "Users can create spaces"
  ON space
  FOR INSERT
  WITH CHECK (true);

-- 6. Allow users to view spaces they created or are members of
-- For now, let's allow viewing all spaces (we'll add space_member table later)
CREATE POLICY "Users can view spaces"
  ON space
  FOR SELECT
  USING (true);

-- 7. Allow space creators to update their spaces
CREATE POLICY "Space creators can update"
  ON space
  FOR UPDATE
  USING (created_by::text = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (created_by::text = current_setting('request.jwt.claims', true)::json->>'sub');

-- 8. Allow space creators to delete their spaces
CREATE POLICY "Space creators can delete"
  ON space
  FOR DELETE
  USING (created_by::text = current_setting('request.jwt.claims', true)::json->>'sub');

-- 9. Verify the policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'space';

-- 10. Test: Check space table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'space'
  AND table_schema = 'public'
ORDER BY ordinal_position;


