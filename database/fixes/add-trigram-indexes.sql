-- Add trigram indexes for fuzzy matching
-- This enables matching "appreciation" to "Appreciation Day", "actives" to "active", etc.

-- Ensure pg_trgm extension is enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram index on resource.title for fuzzy matching
-- This allows similarity searches and partial matches
CREATE INDEX IF NOT EXISTS resource_title_trgm_idx 
  ON resource USING gin (title gin_trgm_ops);

-- Add trigram index on resource.body for fuzzy matching (optional, can be slow)
-- Uncomment if you need fuzzy body search, but be aware it's a large index
-- CREATE INDEX IF NOT EXISTS resource_body_trgm_idx 
--   ON resource USING gin (body gin_trgm_ops);

-- Verify indexes were created
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'resource'
  AND indexname LIKE '%trgm%';

-- Example usage:
-- Find resources with titles similar to "actives meeting"
-- SELECT title, similarity(title, 'actives meeting') AS sim
-- FROM resource
-- WHERE title % 'actives meeting'  -- % is the similarity operator
-- ORDER BY sim DESC
-- LIMIT 5;


