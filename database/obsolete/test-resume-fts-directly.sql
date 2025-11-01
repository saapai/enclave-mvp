-- Direct test to see if FTS can find the resume

-- 1. First, verify the resume exists and has body content
SELECT 
  id,
  title,
  LENGTH(body) as body_length,
  LEFT(body, 200) as body_preview,
  created_by
FROM resource 
WHERE title ILIKE '%resume%'
  AND space_id = '00000000-0000-0000-0000-000000000000';

-- 2. Test if FTS function exists and works with ANY query
SELECT * FROM search_resources_fts('test', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 3. Test with "UCLA" - should find resume
SELECT 
  id, 
  title, 
  rank,
  LEFT(body, 100) as body_preview
FROM search_resources_fts('UCLA', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 4. Test with "resume" - should match title
SELECT 
  id, 
  title, 
  rank
FROM search_resources_fts('resume', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 5. Check if the tsvector matches
SELECT 
  id,
  title,
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')) @@ plainto_tsquery('english', 'UCLA') as matches_ucla,
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')) @@ plainto_tsquery('english', 'resume') as matches_resume
FROM resource 
WHERE title ILIKE '%resume%'
  AND space_id = '00000000-0000-0000-0000-000000000000';

-- 6. Manual FTS query (bypassing function)
SELECT 
  id,
  title,
  ts_rank(
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')),
    plainto_tsquery('english', 'UCLA')
  ) AS rank
FROM resource r
WHERE space_id = '00000000-0000-0000-0000-000000000000'
  AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
      @@ plainto_tsquery('english', 'UCLA')
ORDER BY rank DESC;



