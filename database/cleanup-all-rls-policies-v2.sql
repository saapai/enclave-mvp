-- 🧹 COMPLETE RLS CLEANUP V2 - Handles existing policies

-- Disable RLS on all tables
ALTER TABLE resource DISABLE ROW LEVEL SECURITY;
ALTER TABLE space DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_user DISABLE ROW LEVEL SECURITY;
ALTER TABLE resource_embedding DISABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies (including the ones that might already exist)
DROP POLICY IF EXISTS "Users can create resources" ON resource;
DROP POLICY IF EXISTS "Users can delete own resources" ON resource;
DROP POLICY IF EXISTS "Users can update own resources" ON resource;
DROP POLICY IF EXISTS "Users can view own resources" ON resource;
DROP POLICY IF EXISTS "resource_service_role" ON resource;
DROP POLICY IF EXISTS "resource_authenticated" ON resource;
DROP POLICY IF EXISTS "service_role_all" ON resource;
DROP POLICY IF EXISTS "authenticated_all" ON resource;
DROP POLICY IF EXISTS "resource_all_access" ON resource;
DROP POLICY IF EXISTS "resource_all_access_auth" ON resource;

DROP POLICY IF EXISTS "space_service_role" ON space;
DROP POLICY IF EXISTS "space_authenticated" ON space;
DROP POLICY IF EXISTS "service_role_all" ON space;
DROP POLICY IF EXISTS "authenticated_all" ON space;
DROP POLICY IF EXISTS "Users can view their spaces" ON space;
DROP POLICY IF EXISTS "Users can create spaces" ON space;
DROP POLICY IF EXISTS "space_all_access" ON space;
DROP POLICY IF EXISTS "space_all_access_auth" ON space;

DROP POLICY IF EXISTS "app_user_service_role" ON app_user;
DROP POLICY IF EXISTS "app_user_authenticated" ON app_user;
DROP POLICY IF EXISTS "service_role_all" ON app_user;
DROP POLICY IF EXISTS "authenticated_all" ON app_user;
DROP POLICY IF EXISTS "Users can view their profile" ON app_user;
DROP POLICY IF EXISTS "Users can create their profile" ON app_user;
DROP POLICY IF EXISTS "Users can update their profile" ON app_user;
DROP POLICY IF EXISTS "Users can delete their profile" ON app_user;
DROP POLICY IF EXISTS "app_user_all_access" ON app_user;
DROP POLICY IF EXISTS "app_user_all_access_auth" ON app_user;

DROP POLICY IF EXISTS "embedding_service_role" ON resource_embedding;
DROP POLICY IF EXISTS "embedding_authenticated" ON resource_embedding;
DROP POLICY IF EXISTS "service_role_all" ON resource_embedding;
DROP POLICY IF EXISTS "authenticated_all" ON resource_embedding;
DROP POLICY IF EXISTS "embedding_all_access" ON resource_embedding;
DROP POLICY IF EXISTS "embedding_all_access_auth" ON resource_embedding;

-- Re-enable RLS
ALTER TABLE resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE space ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_embedding ENABLE ROW LEVEL SECURITY;

-- Create simple, permissive policies for API functionality
CREATE POLICY "resource_all_access" ON resource FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "resource_all_access_auth" ON resource FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "space_all_access" ON space FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "space_all_access_auth" ON space FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "app_user_all_access" ON app_user FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "app_user_all_access_auth" ON app_user FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "embedding_all_access" ON resource_embedding FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "embedding_all_access_auth" ON resource_embedding FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Verify cleanup
SELECT 'RLS Cleanup Complete' as status;
SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('resource', 'space', 'app_user', 'resource_embedding') ORDER BY tablename, policyname;
