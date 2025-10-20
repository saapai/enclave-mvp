-- Quick diagnostic - run each query separately

-- 1. Check if default space exists
SELECT 'Default space exists:' as status, COUNT(*) as count 
FROM space 
WHERE id = '00000000-0000-0000-0000-000000000000';

-- 2. Check all spaces
SELECT 'Total spaces:' as status, COUNT(*) as count 
FROM space;

-- 3. Check RLS status
SELECT 'RLS enabled on space:' as status, rowsecurity 
FROM pg_tables 
WHERE tablename = 'space';

-- 4. Check RLS status on app_user
SELECT 'RLS enabled on app_user:' as status, rowsecurity 
FROM pg_tables 
WHERE tablename = 'app_user';

-- 5. Check policies on space table
SELECT 'Space policies count:' as status, COUNT(*) as policy_count 
FROM pg_policies 
WHERE tablename = 'space';

-- 6. Test simple query on space table
SELECT 'Can query space table:' as status, COUNT(*) as space_count 
FROM space;

