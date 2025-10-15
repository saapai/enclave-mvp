-- Test queries to debug FTS search

-- 1. Check if resume exists in database
SELECT id, title, LEFT(body, 100) as body_preview, created_by
FROM resource 
WHERE space_id = '00000000-0000-0000-0000-000000000000'
  AND title ILIKE '%resume%';

-- 2. Test FTS with simple word that's definitely in resume
SELECT id, title, rank
FROM search_resources_fts('UCLA', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 3. Test FTS with "resume" (should match title)
SELECT id, title, rank
FROM search_resources_fts('resume', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 4. Test FTS with "Inquiyr" (in resume body)
SELECT id, title, rank
FROM search_resources_fts('Inquiyr', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 5. Test what the tsvector looks like for the resume
SELECT 
  id,
  title,
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))::text as search_vector_preview
FROM resource 
WHERE title ILIKE '%resume%'
LIMIT 1;

-- 6. Test what the query becomes
SELECT plainto_tsquery('english', 'what does my resume say')::text as processed_query;
SELECT plainto_tsquery('english', 'resume')::text as processed_query;
SELECT plainto_tsquery('english', 'UCLA')::text as processed_query;

