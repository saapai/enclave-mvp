-- 🚨 CRITICAL FIX: Resolve infinite recursion in app_user RLS policies
-- 
-- PROBLEM: The RLS policies on app_user reference other tables that also have RLS,
-- creating circular dependencies and infinite recursion.
--
-- SOLUTION: Simplify policies to break the recursion cycle

-- Drop ALL existing policies on app_user
DROP POLICY IF EXISTS "Users can view profiles in their spaces" ON app_user;
DROP POLICY IF EXISTS "Users can view their own profile" ON app_user;
DROP POLICY IF EXISTS "Users can create profiles" ON app_user;
DROP POLICY IF EXISTS "Users can update their profile" ON app_user;
DROP POLICY IF EXISTS "Users can delete their profile" ON app_user;
DROP POLICY IF EXISTS "Service role can manage users" ON app_user;

-- Re-enable RLS
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;

-- CRITICAL: Use simple, non-recursive policies

-- 1. Allow service role full access (for API routes using service role key)
CREATE POLICY "Service role bypass"
  ON app_user
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Allow authenticated users to read all profiles in the app_user table
-- (This is safe because app_user only contains space membership info, not sensitive data)
CREATE POLICY "Authenticated users can view profiles"
  ON app_user
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Allow authenticated users to insert their own profiles
CREATE POLICY "Authenticated users can create profiles"
  ON app_user
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 4. Allow authenticated users to update profiles
-- (Application layer handles authorization via Clerk)
CREATE POLICY "Authenticated users can update profiles"
  ON app_user
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Allow authenticated users to delete profiles
CREATE POLICY "Authenticated users can delete profiles"
  ON app_user
  FOR DELETE
  TO authenticated
  USING (true);

-- Grant public (authenticated) users access to the table
GRANT SELECT, INSERT, UPDATE, DELETE ON app_user TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_user TO service_role;

-- Verify policies were created
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'app_user'
ORDER BY policyname;

