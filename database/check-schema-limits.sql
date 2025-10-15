-- Check the resource table schema to see if there are column limits

-- 1. Check column data types
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'resource'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Check the actual body content of the resume
SELECT 
  id,
  title,
  created_at,
  CASE 
    WHEN body IS NULL THEN 'NULL'
    WHEN body = '' THEN 'EMPTY STRING'
    ELSE 'HAS CONTENT'
  END as body_status,
  LENGTH(body) as body_length,
  SUBSTRING(body, 1, 100) as body_start,
  SUBSTRING(body, POSITION('UCLA' IN body) - 20, 50) as around_ucla
FROM resource 
WHERE title ILIKE '%resume%'
  AND space_id = '00000000-0000-0000-0000-000000000000'
ORDER BY created_at DESC
LIMIT 1;

