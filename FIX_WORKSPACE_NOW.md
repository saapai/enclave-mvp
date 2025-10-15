# 🚨 Fix Workspace Persistence NOW

## Problem
- ✅ Workspaces can be created
- ❌ Workspaces disappear after page reload
- ❌ Error: "duplicate key value violates unique constraint"

## Solution
Run this SQL migration in Supabase SQL Editor:

### 📋 Copy & Run This SQL:

```sql
-- Fix workspace persistence and member management
-- Run this in Supabase SQL Editor

-- 0. Add user_id column to app_user table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'app_user' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE app_user ADD COLUMN user_id TEXT;
  END IF;
END $$;

-- 0b. Fix unique constraint to allow same user in multiple spaces
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_email_key;

-- Add composite unique constraint (only if it doesn't exist)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'app_user_email_space_key'
  ) THEN
    ALTER TABLE app_user ADD CONSTRAINT app_user_email_space_key 
      UNIQUE (email, space_id);
  END IF;
END $$;

-- 1. Fix space RLS policies to allow viewing spaces user created or is member of
DROP POLICY IF EXISTS "Users can view spaces" ON space;
DROP POLICY IF EXISTS "Users can create spaces" ON space;
DROP POLICY IF EXISTS "Space creators can update" ON space;
DROP POLICY IF EXISTS "Space creators can delete" ON space;

-- Allow users to create spaces
CREATE POLICY "Users can create spaces"
  ON space
  FOR INSERT
  WITH CHECK (true);

-- Allow users to view spaces they created OR are members of
CREATE POLICY "Users can view their spaces"
  ON space
  FOR SELECT
  USING (
    -- User created this space
    created_by = current_setting('request.jwt.claims', true)::json->>'sub'
    OR
    -- User is a member of this space (via app_user table)
    EXISTS (
      SELECT 1 FROM app_user
      WHERE app_user.space_id = space.id
      AND app_user.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
    OR
    -- Default space is visible to everyone
    id = '00000000-0000-0000-0000-000000000000'
  );

-- Allow space creators to update their spaces
CREATE POLICY "Space creators can update"
  ON space
  FOR UPDATE
  USING (created_by = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (created_by = current_setting('request.jwt.claims', true)::json->>'sub');

-- Allow space creators to delete their spaces
CREATE POLICY "Space creators can delete"
  ON space
  FOR DELETE
  USING (created_by = current_setting('request.jwt.claims', true)::json->>'sub');

-- 2. Fix app_user RLS to prevent duplicate key errors
DROP POLICY IF EXISTS "Users can create their profile" ON app_user;
DROP POLICY IF EXISTS "Users can view profiles" ON app_user;
DROP POLICY IF EXISTS "Users can update their profile" ON app_user;
DROP POLICY IF EXISTS "Users can delete their profile" ON app_user;

-- Allow users to insert app_user records (with upsert logic in app)
CREATE POLICY "Users can create profiles"
  ON app_user
  FOR INSERT
  WITH CHECK (true);

-- Allow users to view app_user records in their spaces
CREATE POLICY "Users can view profiles in their spaces"
  ON app_user
  FOR SELECT
  USING (
    -- User can see their own profile
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR
    -- User can see profiles in spaces they're in
    EXISTS (
      SELECT 1 FROM space
      WHERE space.id = app_user.space_id
      AND (
        space.created_by = current_setting('request.jwt.claims', true)::json->>'sub'
        OR EXISTS (
          SELECT 1 FROM app_user au2
          WHERE au2.space_id = space.id
          AND au2.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
      )
    )
  );

-- Allow users to update their own profile
CREATE POLICY "Users can update their profile"
  ON app_user
  FOR UPDATE
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Allow users to delete their own profile
CREATE POLICY "Users can delete their profile"
  ON app_user
  FOR DELETE
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- 3. Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename IN ('space', 'app_user')
ORDER BY tablename, policyname;
```

## ✅ What This Fixes

1. **Workspace Persistence** - Workspaces now persist after reload
2. **Duplicate Key Error** - Same user can be in multiple spaces
3. **RLS Policies** - Users can view spaces they created or are members of
4. **Unique Constraint** - Changed from `email` to `(email, space_id)`

## 🧪 Test After Running

1. **Create Workspace:**
   - Go to Workspaces dialog
   - Create new workspace
   - ✅ Should succeed without errors

2. **Reload Page:**
   - Refresh browser
   - Open Workspaces dialog
   - ✅ Your workspace should still be there

3. **Create Multiple Workspaces:**
   - Create 2-3 workspaces
   - ✅ All should persist

## 🚀 Next Steps

After running this migration, test the automated test suite:

```bash
npm run test:smoke
```

This will verify:
- ✅ Workspace creation works
- ✅ Workspaces persist
- ✅ File uploads work
- ✅ Search works

---

**Run the SQL migration now, then test!** 🎯
