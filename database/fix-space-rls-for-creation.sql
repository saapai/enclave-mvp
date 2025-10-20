-- Fix RLS policies for space table to allow creation and proper access
-- Run this in Supabase SQL Editor

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their spaces" ON space;
DROP POLICY IF EXISTS "Users can create spaces" ON space;
DROP POLICY IF EXISTS "Users can update their spaces" ON space;
DROP POLICY IF EXISTS "Users can delete their spaces" ON space;

-- Enable RLS on space table
ALTER TABLE space ENABLE ROW LEVEL SECURITY;

-- Allow users to insert new spaces (creator is set to their user_id)
CREATE POLICY "Users can create spaces"
  ON space
  FOR INSERT
  WITH CHECK (true);  -- Allow anyone to create, created_by will be set by app

-- Allow users to view spaces they are members of
-- This requires checking the space_member table
CREATE POLICY "Users can view their spaces"
  ON space
  FOR SELECT
  USING (
    created_by::text = current_setting('request.jwt.claims', true)::json->>'sub'
    OR id IN (
      SELECT space_id 
      FROM space_member 
      WHERE user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- Allow space creators to update their spaces
CREATE POLICY "Space creators can update"
  ON space
  FOR UPDATE
  USING (created_by::text = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (created_by::text = current_setting('request.jwt.claims', true)::json->>'sub');

-- Allow space creators to delete their spaces
CREATE POLICY "Space creators can delete"
  ON space
  FOR DELETE
  USING (created_by::text = current_setting('request.jwt.claims', true)::json->>'sub');

-- Verify the policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'space';


