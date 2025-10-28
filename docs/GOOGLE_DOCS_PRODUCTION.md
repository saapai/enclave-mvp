# Google Docs Integration - Production Deployment Guide

## Prerequisites

Before deploying, ensure you have:
- Google Cloud Console project with OAuth credentials
- Production domain (e.g., https://tryenclave.com)
- Supabase production database
- Netlify or Vercel deployment

## Step 1: Google Cloud Console Setup

### 1.1 Update OAuth Redirect URIs

In Google Cloud Console → APIs & Services → Credentials:

**Authorized JavaScript origins:**
- `https://tryenclave.com`
- `https://www.tryenclave.com`

**Authorized redirect URIs:**
- `https://tryenclave.com/api/oauth/google/callback`
- `https://www.tryenclave.com/api/oauth/google/callback`

### 1.2 Enable Required APIs

Ensure these APIs are enabled:
- Google Drive API
- Google Docs API
- Google People API (optional)

## Step 2: Database Setup

### 2.1 Run SQL Scripts in Supabase (Production)

Run these SQL files in order:

1. **`database/fix-google-docs-schema.sql`** (or `database/google-docs-schema.sql`)
   - Creates Google Docs tables

2. **`database/disable-google-docs-rls.sql`**
   - Disables RLS for Google Docs tables

3. **`database/fix-vector-search-types.sql`**
   - Fixes vector search return types

## Step 3: Environment Variables

### 3.1 Netlify/Vercel Environment Variables

Add these environment variables to your deployment platform:

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://tryenclave.com/api/oauth/google/callback

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_production_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_production_supabase_anon_key

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key

# Mistral AI
MISTRAL_API_KEY=your_mistral_api_key
MISTRAL_EMBED_MODEL=mistral-embed

# Node Environment
NODE_ENV=production
```

### 3.2 Important Notes

- **Use HTTPS URLs only** in production
- **Don't use localhost URLs** in production environment variables
- **Ensure GOOGLE_REDIRECT_URI matches** the redirect URI in Google Cloud Console

## Step 4: Webhook Setup (Production Only)

### 4.1 Configure Webhook URL

In your Google Drive API setup, webhooks will use:
```
https://tryenclave.com/api/webhooks/google/drive
```

This will work automatically in production (HTTPS is required).

### 4.2 Watch Management

- Watches expire every ~7 days
- Set up a cron job to renew watches (optional for now)

## Step 5: Testing Production Deployment

### 5.1 Test OAuth Flow

1. Go to https://tryenclave.com
2. Click "Connect Live Doc"
3. Enter a Google Docs URL
4. Complete OAuth authorization
5. Verify the document is connected

### 5.2 Test Search

1. Search for content from the connected Google Doc
2. Verify results appear correctly
3. Make changes to the Google Doc
4. Wait ~30 seconds for webhook (or click "Refresh Docs" in development)
5. Search again to verify updated content

### 5.3 Check Logs

Monitor your deployment logs for:
- OAuth errors
- Database connection issues
- Webhook failures
- Embedding generation errors

## Troubleshooting

### Issue: "redirect_uri_mismatch"

**Solution:** 
- Verify Google Cloud Console redirect URIs match exactly
- Ensure `GOOGLE_REDIRECT_URI` environment variable matches

### Issue: "Google Docs add error: 500"

**Possible causes:**
- Database tables not created
- Missing environment variables
- RLS policies blocking access
- OAuth tokens not stored

**Solution:**
1. Check deployment logs for specific error
2. Verify database schema is applied
3. Ensure all environment variables are set
4. Run `disable-google-docs-rls.sql` if needed

### Issue: Search not finding Google Docs content

**Solution:**
- Run `fix-vector-search-types.sql`
- Check if embeddings are being generated
- Verify chunks are being stored

### Issue: Webhooks not working

**Solution:**
- Ensure production URL uses HTTPS
- Check webhook endpoint is accessible
- Verify watch was created (check `gdrive_watches` table)

## Post-Deployment

### Monitor These:

1. **Webhook expiration**: Watches expire every ~7 days
2. **Token refresh**: OAuth tokens need periodic refresh
3. **Search performance**: Monitor vector search query times
4. **Storage usage**: Google Docs chunks consume database storage

### Recommended Enhancements:

1. Set up automated watch renewal (cron job)
2. Implement error notifications (email/Slack)
3. Add rate limiting for Google API calls
4. Monitor API quota usage in Google Cloud Console

## Need Help?

- Check deployment logs first
- Verify all SQL scripts were run
- Ensure environment variables are set correctly
- Test OAuth flow step by step






