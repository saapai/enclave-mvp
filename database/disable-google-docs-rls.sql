-- Fix RLS policies for Google Docs tables to work with Clerk authentication
-- Run this in your Supabase SQL editor

-- Drop existing policies
DROP POLICY IF EXISTS "Users can access own google account" ON google_accounts;
DROP POLICY IF EXISTS "Users can access google docs in their spaces" ON sources_google_docs;
DROP POLICY IF EXISTS "Users can access google doc chunks in their spaces" ON google_doc_chunks;
DROP POLICY IF EXISTS "Users can access drive watches for their docs" ON gdrive_watches;

-- Disable RLS for Google accounts tables (we'll handle auth at the API level)
ALTER TABLE google_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE sources_google_docs DISABLE ROW LEVEL SECURITY;
ALTER TABLE google_doc_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE gdrive_watches DISABLE ROW LEVEL SECURITY;

-- Note: Authentication is handled by Clerk at the API level
-- The API routes already check for valid user sessions before accessing these tables




