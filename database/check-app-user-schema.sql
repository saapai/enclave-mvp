-- Check app_user table schema and constraints
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'app_user'
ORDER BY ordinal_position;

-- Check constraints
SELECT
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'app_user'::regclass
ORDER BY contype, conname;
