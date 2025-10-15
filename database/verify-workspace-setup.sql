-- Verify workspace setup is complete
-- Run this to check if everything is configured correctly

-- 1. Check app_user table structure
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'app_user'
ORDER BY ordinal_position;

-- 2. Check app_user constraints
SELECT
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'app_user'::regclass
ORDER BY conname;

-- 3. Check space table structure
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'space'
ORDER BY ordinal_position;

-- 4. Check RLS policies
SELECT 
    schemaname,
    tablename,
    policyname,
    cmd,
    roles
FROM pg_policies
WHERE tablename IN ('space', 'app_user')
ORDER BY tablename, policyname;

-- 5. Test query: Check if user_id column exists in app_user
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'app_user' AND column_name = 'user_id'
        ) THEN '✅ user_id column exists'
        ELSE '❌ user_id column missing'
    END AS user_id_status;

-- 6. Test query: Check if composite unique constraint exists
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'app_user_email_space_key'
        ) THEN '✅ Composite unique constraint exists (email, space_id)'
        ELSE '❌ Composite unique constraint missing'
    END AS constraint_status;

-- 7. Test query: Check if created_by column exists in space
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'space' AND column_name = 'created_by'
        ) THEN '✅ created_by column exists in space'
        ELSE '❌ created_by column missing in space'
    END AS created_by_status;
