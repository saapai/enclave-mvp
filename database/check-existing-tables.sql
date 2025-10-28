-- 🔍 Check what tables actually exist in the database

SELECT 
  table_name,
  table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'resource', 'space', 'app_user', 
    'google_docs_chunks', 'calendar_events_chunks', 
    'resource_embedding', 'google_accounts'
  )
ORDER BY table_name;


