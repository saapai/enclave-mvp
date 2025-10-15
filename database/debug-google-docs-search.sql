-- Debug Google Docs search issues
-- Run this in Supabase SQL Editor to check what's happening

-- 1. Check if google_doc_chunks table exists
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('google_doc_chunks', 'google_docs_chunks', 'sources_google_docs')
ORDER BY table_name, ordinal_position;

-- 2. Check if search_google_docs_vector function exists and what it returns
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname LIKE '%google_docs%';

-- 3. Check what tables actually exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%google%'
ORDER BY table_name;

-- 4. Test the function directly (if it exists)
-- SELECT * FROM search_google_docs_vector(
--   array_fill(0.1, ARRAY[1024])::vector,
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   5,
--   0,
--   null
-- ) LIMIT 1;
