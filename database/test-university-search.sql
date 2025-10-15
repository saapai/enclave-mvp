-- Test searching for words that ARE in the resume

-- 1. Test "University" (definitely in there)
SELECT 
  id, 
  title, 
  rank
FROM search_resources_fts('University', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 2. Test "Inquiyr" (your startup)
SELECT 
  id, 
  title, 
  rank
FROM search_resources_fts('Inquiyr', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 3. Test "HOSA"
SELECT 
  id, 
  title, 
  rank
FROM search_resources_fts('HOSA', '00000000-0000-0000-0000-000000000000', 10, 0);

-- 4. Verify what's actually in the body
SELECT 
  body ILIKE '%UCLA%' as has_ucla_acronym,
  body ILIKE '%University of California%' as has_full_name,
  body ILIKE '%Inquiyr%' as has_inquiyr,
  body ILIKE '%HOSA%' as has_hosa
FROM resource 
WHERE title ILIKE '%resume%'
  AND space_id = '00000000-0000-0000-0000-000000000000'
ORDER BY created_at DESC
LIMIT 1;

