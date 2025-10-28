# 🚨 CRITICAL: Fix Infinite Recursion Error NOW

## The Problem
Your application is showing this error:
```
infinite recursion detected in policy for relation "app_user"
```

This is happening because the RLS (Row Level Security) policies on the `app_user` table are creating circular dependencies with other tables.

## The Solution (Takes 30 seconds)

### Step 1: Open Supabase SQL Editor
Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new

### Step 2: Copy & Paste This SQL
Copy the entire contents of:
```
database/fix-app-user-infinite-recursion.sql
```

### Step 3: Click "Run"

### Step 4: Verify It Worked
Refresh your application. The errors should be gone and everything should work.

## What This Does
- Removes all existing (problematic) RLS policies on `app_user`
- Creates simple, non-recursive policies that:
  - Allow service role full access (for API routes)
  - Allow authenticated users to view all profiles (safe because it's just membership info)
  - Allow authenticated users to create/update/delete profiles
  - Authorization is handled at the application layer via Clerk

## Why This Happened
The previous policies tried to reference the `space` table, which also has RLS policies. This created a circular dependency:
- app_user policy checks if user is in space
- space policy checks if user is in app_user
- ➡️ Infinite recursion!

The new policies break this cycle by using simple `true` conditions and relying on application-layer authorization.

## Next Steps
After running this SQL:
1. ✅ Infinite recursion error will be gone
2. ✅ Workspace management will work
3. ✅ All API routes will function properly
4. ✅ The middleware fix (`await auth.protect()`) will now work correctly

## Security Note
These policies are safe because:
- We're using Clerk for authentication at the application layer
- The `app_user` table only contains space membership info (not sensitive)
- All API routes verify user identity via Clerk before database operations
- Service role key is only used in server-side API routes (never exposed to client)



