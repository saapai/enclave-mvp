-- 🚨 IMMEDIATE FIX - Disable RLS to get your app working

-- Temporarily disable RLS on both tables
ALTER TABLE space DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_user DISABLE ROW LEVEL SECURITY;

-- Verify RLS is disabled
SELECT 'RLS disabled on space:' as status, rowsecurity 
FROM pg_tables 
WHERE tablename = 'space';

SELECT 'RLS disabled on app_user:' as status, rowsecurity 
FROM pg_tables 
WHERE tablename = 'app_user';

-- Test that we can query spaces
SELECT 'Spaces accessible:' as status, COUNT(*) as count 
FROM space;


