-- Check if the resume body is actually stored

-- 1. Check the exact body content
SELECT 
  id,
  title,
  body IS NULL as body_is_null,
  LENGTH(body) as body_length,
  LEFT(body, 500) as body_first_500_chars
FROM resource 
WHERE title ILIKE '%resume%'
  AND space_id = '00000000-0000-0000-0000-000000000000'
ORDER BY created_at DESC
LIMIT 1;

-- 2. Check if 'UCLA' is in the body as plain text
SELECT 
  id,
  title,
  body LIKE '%UCLA%' as contains_ucla_case_sensitive,
  body ILIKE '%UCLA%' as contains_ucla_case_insensitive,
  body ILIKE '%Los Angeles%' as contains_los_angeles
FROM resource 
WHERE title ILIKE '%resume%'
  AND space_id = '00000000-0000-0000-0000-000000000000'
ORDER BY created_at DESC
LIMIT 1;

-- 3. Check all columns for the most recent resume
SELECT *
FROM resource 
WHERE title ILIKE '%resume%'
  AND space_id = '00000000-0000-0000-0000-000000000000'
ORDER BY created_at DESC
LIMIT 1;


