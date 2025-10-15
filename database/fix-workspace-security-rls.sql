-- 🔒 Fix workspace security - users should only see resources from workspaces they are members of

-- 1. Fix resource table RLS to check workspace membership
ALTER TABLE resource DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON resource;
DROP POLICY IF EXISTS "authenticated_all" ON resource;

ALTER TABLE resource ENABLE ROW LEVEL SECURITY;

-- Policy for service_role (admin access)
CREATE POLICY "service_role_all"
  ON resource FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Policy for authenticated users - only see resources from workspaces they are members of
CREATE POLICY "authenticated_workspace_members"
  ON resource FOR ALL TO authenticated
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

-- 2. Fix space table RLS to check membership
ALTER TABLE space DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON space;
DROP POLICY IF EXISTS "authenticated_all" ON space;

ALTER TABLE space ENABLE ROW LEVEL SECURITY;

-- Policy for service_role (admin access)
CREATE POLICY "service_role_all"
  ON space FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Policy for authenticated users - only see spaces they are members of or created
CREATE POLICY "authenticated_workspace_members"
  ON space FOR ALL TO authenticated
  USING (
    created_by = auth.uid()::text
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

-- 3. Fix app_user table RLS to check membership
ALTER TABLE app_user DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON app_user;
DROP POLICY IF EXISTS "authenticated_all" ON app_user;

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;

-- Policy for service_role (admin access)
CREATE POLICY "service_role_all"
  ON app_user FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Policy for authenticated users - only see app_user records from spaces they are members of
CREATE POLICY "authenticated_workspace_members"
  ON app_user FOR ALL TO authenticated
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

-- 4. Fix google_docs_chunks table RLS
ALTER TABLE google_docs_chunks DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON google_docs_chunks;
DROP POLICY IF EXISTS "authenticated_all" ON google_docs_chunks;

ALTER TABLE google_docs_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON google_docs_chunks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_workspace_members"
  ON google_docs_chunks FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_user 
      WHERE app_user.space_id = google_docs_chunks.space_id 
      AND app_user.email = (
        SELECT email FROM google_accounts 
        WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_user 
      WHERE app_user.space_id = google_docs_chunks.space_id 
      AND app_user.email = (
        SELECT email FROM google_accounts 
        WHERE user_id = auth.uid()
      )
    )
  );

-- 5. Fix calendar_events_chunks table RLS
ALTER TABLE calendar_events_chunks DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON calendar_events_chunks;
DROP POLICY IF EXISTS "authenticated_all" ON calendar_events_chunks;

ALTER TABLE calendar_events_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON calendar_events_chunks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_workspace_members"
  ON calendar_events_chunks FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_user 
      WHERE app_user.space_id = calendar_events_chunks.space_id 
      AND app_user.email = (
        SELECT email FROM google_accounts 
        WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_user 
      WHERE app_user.space_id = calendar_events_chunks.space_id 
      AND app_user.email = (
        SELECT email FROM google_accounts 
        WHERE user_id = auth.uid()
      )
    )
  );

-- 6. Fix resource_embedding table RLS
ALTER TABLE resource_embedding DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON resource_embedding;
DROP POLICY IF EXISTS "authenticated_all" ON resource_embedding;

ALTER TABLE resource_embedding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON resource_embedding FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_workspace_members"
  ON resource_embedding FOR ALL TO authenticated
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

-- Verify policies were created
SELECT 
  'RLS Policies Updated' as status,
  COUNT(*) as policy_count
FROM pg_policies 
WHERE tablename IN (
  'resource', 'space', 'app_user', 
  'google_docs_chunks', 'calendar_events_chunks', 
  'resource_embedding'
);
