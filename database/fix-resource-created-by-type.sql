-- Fix created_by column type to support Clerk user IDs (text)
-- This aligns with how we handle user IDs in Google Docs/Calendar integrations

-- STEP 1: Temporarily disable RLS to allow column type change
ALTER TABLE resource DISABLE ROW LEVEL SECURITY;

-- STEP 2: Drop ALL existing RLS policies (now that RLS is disabled, this should work)
DO $$ 
DECLARE
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'resource'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON resource', pol.policyname);
    END LOOP;
END $$;

-- STEP 3: Drop foreign key constraint
ALTER TABLE resource 
DROP CONSTRAINT IF EXISTS resource_created_by_fkey;

-- STEP 4: Change created_by from UUID to TEXT
ALTER TABLE resource 
ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;

-- STEP 5: Add index for performance
CREATE INDEX IF NOT EXISTS idx_resource_created_by ON resource(created_by);

-- STEP 6: Re-enable RLS
ALTER TABLE resource ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own resources" ON resource
  FOR SELECT
  USING (created_by::text = auth.uid()::text);

CREATE POLICY "Users can create resources" ON resource
  FOR INSERT
  WITH CHECK (created_by::text = auth.uid()::text);

CREATE POLICY "Users can update own resources" ON resource
  FOR UPDATE
  USING (created_by::text = auth.uid()::text)
  WITH CHECK (created_by::text = auth.uid()::text);

CREATE POLICY "Users can delete own resources" ON resource
  FOR DELETE
  USING (created_by::text = auth.uid()::text);

-- Update search_resources_fts function to return TEXT for created_by
-- Remove auth.uid() filtering since we use Clerk (not Supabase Auth)
DROP FUNCTION IF EXISTS search_resources_fts(text, uuid, integer, integer);
DROP FUNCTION IF EXISTS search_resources_fts(text, uuid, integer, integer, text);

CREATE OR REPLACE FUNCTION search_resources_fts(
  search_query TEXT,
  target_space_id UUID,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  space_id UUID,
  type TEXT,
  title TEXT,
  body TEXT,
  url TEXT,
  created_by TEXT,  -- Changed from UUID to TEXT
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.space_id,
    r.type,
    r.title,
    r.body,
    r.url,
    r.created_by,
    r.created_at,
    r.updated_at,
    ts_rank(
      to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, '')),
      plainto_tsquery('english', search_query)
    ) AS rank
  FROM resource r
  WHERE r.space_id = target_space_id
    AND to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, ''))
        @@ plainto_tsquery('english', search_query)
    -- No user filtering here - handled at application level with Clerk auth
  ORDER BY rank DESC, r.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

