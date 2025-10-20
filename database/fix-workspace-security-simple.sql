-- 🔒 Fix workspace security - SIMPLE CLEAN VERSION
-- This fixes the cross-workspace visibility issue

-- Disable RLS on core tables
ALTER TABLE resource DISABLE ROW LEVEL SECURITY;
ALTER TABLE space DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_user DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "service_role_all" ON resource;
DROP POLICY IF EXISTS "authenticated_all" ON resource;
DROP POLICY IF EXISTS "resource_service_role" ON resource;
DROP POLICY IF EXISTS "resource_authenticated" ON resource;

DROP POLICY IF EXISTS "service_role_all" ON space;
DROP POLICY IF EXISTS "authenticated_all" ON space;
DROP POLICY IF EXISTS "space_service_role" ON space;
DROP POLICY IF EXISTS "space_authenticated" ON space;

DROP POLICY IF EXISTS "service_role_all" ON app_user;
DROP POLICY IF EXISTS "authenticated_all" ON app_user;
DROP POLICY IF EXISTS "app_user_service_role" ON app_user;
DROP POLICY IF EXISTS "app_user_authenticated" ON app_user;

-- Re-enable RLS
ALTER TABLE resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE space ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;

-- Create new policies for resource table
CREATE POLICY "resource_service_role" ON resource FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "resource_authenticated" ON resource FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_user 
    WHERE app_user.space_id = resource.space_id 
    AND app_user.email = (
      SELECT email FROM google_accounts 
      WHERE user_id = auth.uid()
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM app_user 
    WHERE app_user.space_id = resource.space_id 
    AND app_user.email = (
      SELECT email FROM google_accounts 
      WHERE user_id = auth.uid()
    )
  )
);

-- Create new policies for space table
CREATE POLICY "space_service_role" ON space FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "space_authenticated" ON space FOR ALL TO authenticated
USING (
  created_by::uuid = auth.uid()
  OR EXISTS (
    SELECT 1 FROM app_user 
    WHERE app_user.space_id = space.id 
    AND app_user.email = (
      SELECT email FROM google_accounts 
      WHERE user_id = auth.uid()
    )
  )
)
WITH CHECK (true);

-- Create new policies for app_user table
CREATE POLICY "app_user_service_role" ON app_user FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "app_user_authenticated" ON app_user FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_user au2
    WHERE au2.space_id = app_user.space_id 
    AND au2.email = (
      SELECT email FROM google_accounts 
      WHERE user_id = auth.uid()
    )
  )
)
WITH CHECK (true);

-- Handle resource_embedding table if it exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'resource_embedding' AND table_schema = 'public') THEN
        ALTER TABLE resource_embedding DISABLE ROW LEVEL SECURITY;
        
        DROP POLICY IF EXISTS "service_role_all" ON resource_embedding;
        DROP POLICY IF EXISTS "authenticated_all" ON resource_embedding;
        DROP POLICY IF EXISTS "embedding_service_role" ON resource_embedding;
        DROP POLICY IF EXISTS "embedding_authenticated" ON resource_embedding;
        
        ALTER TABLE resource_embedding ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY "embedding_service_role" ON resource_embedding FOR ALL TO service_role USING (true) WITH CHECK (true);
        
        CREATE POLICY "embedding_authenticated" ON resource_embedding FOR ALL TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM resource r
            JOIN app_user au ON au.space_id = r.space_id
            WHERE r.id = resource_embedding.resource_id
            AND au.email = (
              SELECT email FROM google_accounts 
              WHERE user_id = auth.uid()
            )
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM resource r
            JOIN app_user au ON au.space_id = r.space_id
            WHERE r.id = resource_embedding.resource_id
            AND au.email = (
              SELECT email FROM google_accounts 
              WHERE user_id = auth.uid()
            )
          )
        );
    END IF;
END $$;

-- Verify policies were created
SELECT 'RLS Policies Created Successfully' as status;
SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('resource', 'space', 'app_user', 'resource_embedding') ORDER BY tablename, policyname;

