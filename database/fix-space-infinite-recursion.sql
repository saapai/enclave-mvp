-- 🚨 CRITICAL FIX: Resolve potential infinite recursion in space RLS policies
-- 
-- This prevents circular dependencies between space and app_user tables

-- Drop ALL existing policies on space
DROP POLICY IF EXISTS "Users can view their spaces" ON space;
DROP POLICY IF EXISTS "Users can view default space" ON space;
DROP POLICY IF EXISTS "Users can create spaces" ON space;
DROP POLICY IF EXISTS "Space creators can update" ON space;
DROP POLICY IF EXISTS "Space creators can delete" ON space;
DROP POLICY IF EXISTS "Service role can manage spaces" ON space;

-- Re-enable RLS
ALTER TABLE space ENABLE ROW LEVEL SECURITY;

-- CRITICAL: Use simple, non-recursive policies

-- 1. Allow service role full access (for API routes using service role key)
CREATE POLICY "Service role bypass"
  ON space
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Allow authenticated users to view all spaces
-- (Application layer via API routes handles which spaces a user should see)
CREATE POLICY "Authenticated users can view spaces"
  ON space
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Allow authenticated users to create spaces
CREATE POLICY "Authenticated users can create spaces"
  ON space
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 4. Allow authenticated users to update spaces
-- (Application layer via API routes verifies user is admin/creator)
CREATE POLICY "Authenticated users can update spaces"
  ON space
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Allow authenticated users to delete spaces
-- (Application layer via API routes verifies user is admin/creator)
CREATE POLICY "Authenticated users can delete spaces"
  ON space
  FOR DELETE
  TO authenticated
  USING (true);

-- Grant public (authenticated) users access to the table
GRANT SELECT, INSERT, UPDATE, DELETE ON space TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON space TO service_role;

-- Verify policies were created
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE tablename = 'space'
ORDER BY policyname;


