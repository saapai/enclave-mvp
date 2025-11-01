-- CRITICAL FIX: Resource visibility and RLS
-- This fixes:
-- 1. Resources showing in queries but not in resources page
-- 2. Resources being shared across different user accounts

-- First, let's understand the problem:
-- - Google Doc chunks are searchable (via search_google_docs_vector)
-- - But the resource entries may not exist or aren't visible
-- - RLS policies allow ALL resources in default space to be seen by ALL users
-- - This creates cross-account data leakage

-- STEP 1: Update RLS policies to be user-specific
ALTER TABLE resource ENABLE ROW LEVEL SECURITY;

-- Drop all existing resource policies
DROP POLICY IF EXISTS "Users can view resources in their spaces" ON resource;
DROP POLICY IF EXISTS "Users can view their own resources" ON resource;
DROP POLICY IF EXISTS "Users can create resources in their spaces" ON resource;
DROP POLICY IF EXISTS "Users can create resources" ON resource;
DROP POLICY IF EXISTS "Users can update their own resources" ON resource;
DROP POLICY IF EXISTS "Users can delete their own resources" ON resource;
DROP POLICY IF EXISTS "Service role can manage resources" ON resource;
DROP POLICY IF EXISTS "Users can view own resources" ON resource;
DROP POLICY IF EXISTS "Users can create own resources" ON resource;
DROP POLICY IF EXISTS "Users can update own resources" ON resource;
DROP POLICY IF EXISTS "Users can delete own resources" ON resource;
DROP POLICY IF EXISTS "Service role full access" ON resource;

-- New policy: Users can ONLY see their own resources
CREATE POLICY "Users can view own resources" ON resource
  FOR SELECT
  USING (
    created_by IS NOT NULL AND created_by::text = auth.uid()::text
  );

-- Users can create resources (must be their own)
CREATE POLICY "Users can create own resources" ON resource
  FOR INSERT
  WITH CHECK (
    created_by::text = auth.uid()::text
  );

-- Users can update their own resources
CREATE POLICY "Users can update own resources" ON resource
  FOR UPDATE
  USING (created_by::text = auth.uid()::text)
  WITH CHECK (created_by::text = auth.uid()::text);

-- Users can delete their own resources
CREATE POLICY "Users can delete own resources" ON resource
  FOR DELETE
  USING (created_by::text = auth.uid()::text);

-- Service role bypasses RLS
CREATE POLICY "Service role full access" ON resource
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- STEP 2: Update Google Docs RLS to be user-specific
DROP POLICY IF EXISTS "Users can access google docs in their spaces" ON sources_google_docs;
DROP POLICY IF EXISTS "Users can access google doc chunks in their spaces" ON google_doc_chunks;
DROP POLICY IF EXISTS "Users can access own google docs" ON sources_google_docs;
DROP POLICY IF EXISTS "Users can access own google doc chunks" ON google_doc_chunks;

CREATE POLICY "Users can access own google docs" ON sources_google_docs
  FOR ALL 
  USING (added_by::text = auth.uid()::text);

CREATE POLICY "Users can access own google doc chunks" ON google_doc_chunks
  FOR ALL 
  USING (
    source_id IN (
      SELECT id FROM sources_google_docs WHERE added_by::text = auth.uid()::text
    )
  );

-- STEP 3: Update search function to respect user filtering
DROP FUNCTION IF EXISTS search_google_docs_vector(vector, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_google_docs_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  source_id UUID,
  heading_path TEXT[],
  text TEXT,
  metadata JSONB,
  similarity FLOAT8,
  added_by TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gdc.id,
    gdc.source_id,
    gdc.heading_path,
    gdc.text,
    gdc.metadata,
    (1 - (gdc.embedding <=> query_embedding))::FLOAT8 AS similarity,
    sgd.added_by,
    gdc.created_at,
    gdc.updated_at
  FROM google_doc_chunks gdc
  JOIN sources_google_docs sgd ON gdc.source_id = sgd.id
  WHERE gdc.space_id = target_space_id
    AND sgd.added_by::text = auth.uid()::text  -- CRITICAL: Filter by user
  ORDER BY gdc.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- STEP 4: Update search_resources function to respect user filtering
DROP FUNCTION IF EXISTS search_resources(text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_resources(
  search_query TEXT,
  target_space_id UUID,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  body TEXT,
  type TEXT,
  url TEXT,
  created_by TEXT,
  space_id UUID,
  rank REAL,
  score REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.title,
    r.body,
    r.type,
    r.url,
    r.created_by,
    r.space_id,
    ts_rank(
      to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, '')),
      plainto_tsquery('english', search_query)
    ) AS rank,
    ts_rank(
      to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, '')),
      plainto_tsquery('english', search_query)
    ) AS score
  FROM resource r
  WHERE r.space_id = target_space_id
    AND r.created_by::text = auth.uid()::text  -- CRITICAL: Filter by user
    AND (
      to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, '')) 
      @@ plainto_tsquery('english', search_query)
    )
  ORDER BY rank DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verification queries (run these to check)
-- SELECT COUNT(*) FROM resource WHERE created_by IS NOT NULL;
-- SELECT COUNT(*) FROM sources_google_docs;
-- SELECT DISTINCT added_by FROM sources_google_docs;

