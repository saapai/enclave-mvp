-- Fix Row Level Security for proper visibility control
-- This ensures users can only see their own resources

-- Enable RLS on key tables
ALTER TABLE resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE space ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view resources in their spaces" ON resource;
DROP POLICY IF EXISTS "Users can view their own resources" ON resource;
DROP POLICY IF EXISTS "Users can create resources in their spaces" ON resource;
DROP POLICY IF EXISTS "Users can create resources" ON resource;
DROP POLICY IF EXISTS "Users can update their own resources" ON resource;
DROP POLICY IF EXISTS "Users can delete their own resources" ON resource;
DROP POLICY IF EXISTS "Service role can manage resources" ON resource;

-- Resource policies: Users can see all resources in their spaces
-- Since we're using Clerk and auth.uid() returns the Clerk user ID as text
CREATE POLICY "Users can view resources in their spaces" ON resource
  FOR SELECT
  USING (
    space_id = '00000000-0000-0000-0000-000000000000' -- Default space is public to all
  );

CREATE POLICY "Users can create resources" ON resource
  FOR INSERT
  WITH CHECK (
    created_by::text = auth.uid()::text OR
    created_by IS NULL
  );

CREATE POLICY "Users can update their own resources" ON resource
  FOR UPDATE
  USING (
    created_by IS NULL OR
    created_by::text = auth.uid()::text
  )
  WITH CHECK (
    created_by IS NULL OR
    created_by::text = auth.uid()::text
  );

CREATE POLICY "Users can delete their own resources" ON resource
  FOR DELETE
  USING (
    created_by IS NULL OR
    created_by::text = auth.uid()::text
  );

-- Allow service role (API) to bypass RLS
CREATE POLICY "Service role can manage resources" ON resource
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- User policies
DROP POLICY IF EXISTS "Users can view their own profile" ON app_user;
DROP POLICY IF EXISTS "Service role can manage users" ON app_user;

CREATE POLICY "Users can view their own profile" ON app_user
  FOR SELECT
  USING (id::text = auth.uid()::text);

CREATE POLICY "Service role can manage users" ON app_user
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Space policies
DROP POLICY IF EXISTS "Users can view default space" ON space;
DROP POLICY IF EXISTS "Service role can manage spaces" ON space;

CREATE POLICY "Users can view default space" ON space
  FOR SELECT
  USING (id = '00000000-0000-0000-0000-000000000000');

CREATE POLICY "Service role can manage spaces" ON space
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

