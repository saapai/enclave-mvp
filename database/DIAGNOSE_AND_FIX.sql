-- 🔍 DIAGNOSE AND FIX - Run this to see what's wrong

-- 1. Check if default space exists
SELECT 'Default space check' as check_type, id, name, created_at 
FROM space 
WHERE id = '00000000-0000-0000-0000-000000000000';

-- 2. Check all spaces
SELECT 'All spaces' as check_type, id, name, created_at 
FROM space 
ORDER BY created_at;

-- 3. Check RLS policies on space table
SELECT 'Space policies' as check_type, policyname, roles, cmd 
FROM pg_policies 
WHERE tablename = 'space'
ORDER BY policyname;

-- 4. Check RLS policies on app_user table
SELECT 'App user policies' as check_type, policyname, roles, cmd 
FROM pg_policies 
WHERE tablename = 'app_user'
ORDER BY policyname;

-- 5. Check if RLS is enabled
SELECT 'RLS status' as check_type, tablename, rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename IN ('app_user', 'space')
ORDER BY tablename;

-- 6. Try to insert default space (in case it doesn't exist)
INSERT INTO space (id, name, domain, default_visibility, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Default Workspace',
  NULL,
  'space',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

-- 7. Verify default space after insert/update
SELECT 'Default space after fix' as check_type, id, name, created_at 
FROM space 
WHERE id = '00000000-0000-0000-0000-000000000000';

-- 8. Test if we can select from space table (simulate API call)
SELECT 'Test query' as check_type, COUNT(*) as space_count
FROM space;

-- 9. Check if there are any app_user entries
SELECT 'App users count' as check_type, COUNT(*) as user_count
FROM app_user;

