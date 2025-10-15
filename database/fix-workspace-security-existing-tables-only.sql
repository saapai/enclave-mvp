-- 🔒 Fix workspace security - ONLY for tables that actually exist
-- This version only applies RLS to tables that exist in your database

-- First, let's disable RLS on core tables and drop all existing policies
ALTER TABLE resource DISABLE ROW LEVEL SECURITY;
ALTER TABLE space DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_user DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies for core tables
DO $$ 
DECLARE
    r RECORD;
BEGIN
    -- Drop policies for resource table
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'resource') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON resource';
    END LOOP;
    
    -- Drop policies for space table
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'space') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON space';
    END LOOP;
    
    -- Drop policies for app_user table
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'app_user') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON app_user';
    END LOOP;
END $$;

-- Now re-enable RLS and create new policies
ALTER TABLE resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE space ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;

-- 1. Resource table policies
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

-- 2. Space table policies
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

-- 3. App_user table policies
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

-- Check if resource_embedding table exists and apply RLS if it does
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'resource_embedding' AND table_schema = 'public') THEN
        ALTER TABLE resource_embedding DISABLE ROW LEVEL SECURITY;
        
        -- Drop existing policies
        FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'resource_embedding') LOOP
            EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON resource_embedding';
        END LOOP;
        
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
        
        RAISE NOTICE 'Applied RLS to resource_embedding table';
    ELSE
        RAISE NOTICE 'resource_embedding table does not exist, skipping';
    END IF;
END $$;

-- Verify policies were created
SELECT 
  'RLS Policies Created' as status,
  COUNT(*) as policy_count
FROM pg_policies 
WHERE tablename IN ('resource', 'space', 'app_user', 'resource_embedding');
