-- Add indexes to speed up lexical search queries
-- Run this in your Supabase SQL editor

-- Index for space_id + title lookups (most common)
CREATE INDEX IF NOT EXISTS idx_resource_space_title 
ON resource(space_id, title);

-- Index for space_id + updated_at (for ordering)
CREATE INDEX IF NOT EXISTS idx_resource_space_updated 
ON resource(space_id, updated_at DESC);

-- Trigram index for fuzzy text search on title
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_resource_title_trgm 
ON resource USING gin (title gin_trgm_ops);

-- Trigram index for fuzzy text search on body
CREATE INDEX IF NOT EXISTS idx_resource_body_trgm 
ON resource USING gin (body gin_trgm_ops);

-- Check existing indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'resource'
ORDER BY indexname;

