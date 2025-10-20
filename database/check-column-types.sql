-- 🔍 Check the actual data types of columns that might be causing type casting issues

SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name IN ('space', 'app_user', 'google_accounts', 'resource')
  AND column_name IN ('created_by', 'user_id', 'id', 'space_id')
ORDER BY table_name, column_name;

