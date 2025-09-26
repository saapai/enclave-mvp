# Database Setup Guide for Enclave MVP

## Step 1: Update Environment Variables

Update your `.env.local` file with these values:

```env
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_ZW5hYmxlZC1ob3JuZXQtODIuY2xlcmsuYWNjb3VudHMuZGV2JA
CLERK_SECRET_KEY=sk_test_UWkSmY5hGCKXMQYacy862XeHwGHNoHn9kueUDDWFvV

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://igruzwyaohsbozlgihs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlncnV6d3lhb2hzYm96bGdoaWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE1NzUzMDYsImV4cCI6MjA2NzE1MTMwNn0.voGVT5wnobV-cNtMW2TL_YEHyzLSCKaDePXPjrqCheU
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Step 2: Set up Supabase Database

1. Go to your Supabase project dashboard: https://supabase.com/dashboard/project/igruzwyaohsbozlgihs
2. Navigate to the **SQL Editor** tab
3. Run the following SQL files in order:

### 2.1: Create Tables and Basic Structure
Copy and paste the contents of `supabase-setup.sql` into the SQL Editor and run it.

### 2.2: Create Search Function
Copy and paste the contents of `supabase-search-function.sql` into the SQL Editor and run it.

### 2.3: Add Demo Data (Optional)
Copy and paste the contents of `supabase-demo-data.sql` into the SQL Editor and run it.

## Step 3: Get Service Role Key

1. In your Supabase dashboard, go to **Settings** → **API**
2. Copy the **service_role** key (not the anon key)
3. Update the `SUPABASE_SERVICE_ROLE_KEY` in your `.env.local` file

## Step 4: Test the Setup

1. Run the development server:
   ```bash
   npm run dev
   ```

2. Open http://localhost:3000 in your browser
3. You should see the Enclave login page
4. Sign up for a new account
5. Once logged in, you should see the search interface

## Troubleshooting

### If you get permission errors:
- Make sure you're using the SQL Editor in the Supabase dashboard, not a direct database connection
- The SQL Editor runs with the proper permissions

### If tables already exist:
- The SQL uses `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING` to handle existing data
- You can safely run the setup scripts multiple times

### If you need to start fresh:
- You can drop all tables and recreate them, but be careful as this will delete all data

## Verification

After running the setup, you should have:
- ✅ 8 tables created (space, app_user, resource, tag, resource_tag, event_meta, query_log, gap_alert)
- ✅ 1 default space with ID '00000000-0000-0000-0000-000000000000'
- ✅ 24 default tags across different categories
- ✅ 5 sample resources with proper relationships
- ✅ Full-text search function working
- ✅ All indexes created for performance

The app should now be fully functional!

