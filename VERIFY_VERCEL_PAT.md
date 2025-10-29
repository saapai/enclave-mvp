# Verify PAT in Vercel

Your PAT permissions look perfect! The issue is likely that the PAT in Vercel doesn't match your Airtable PAT.

## Quick Check List

### 1. Verify PAT Token in Vercel Matches Airtable

1. Go to **Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**
2. Find `AIRTABLE_API_KEY`
3. **Click "Reveal"** to see the full token
4. Compare it with the token in Airtable:
   - Go to https://airtable.com/create/tokens
   - Find your "enclave" token
   - Click on it to see the token preview
   - The **first 10-15 characters** should match what's in Vercel

### 2. Common Issues

**Issue: Token doesn't match**
- Solution: Copy the PAT from Airtable and update `AIRTABLE_API_KEY` in Vercel

**Issue: Token has whitespace**
- Check if there are any spaces before/after the token
- The token should start with `pat` and have no spaces

**Issue: Using old API key**
- Old API keys start with `key...` 
- PATs start with `pat...`
- Make sure you're using a PAT, not an old API key

### 3. After Updating Vercel

1. **Save** the environment variable in Vercel
2. **Redeploy** your application (or it will auto-redeploy)
3. Wait for deployment to complete
4. Test sending a poll again

### 4. Test Locally (Optional)

If you want to test your PAT locally:

1. Copy your PAT from Airtable
2. Create `.env.local` in the project root:
   ```env
   AIRTABLE_API_KEY=pat_your_token_here
   AIRTABLE_BASE_ID=appecxe8XTHF7yA5a
   AIRTABLE_TABLE_ID=tblfvnRHv6McCSwIR
   AIRTABLE_TABLE_NAME=Enclave
   ```
3. Run: `node scripts/test-metadata-api.js`

---

## Expected Result After Fix

When you send the next poll, you should see:
```
[Airtable] ✓ PAT format valid (starts with "pat", length: XX)
[Airtable] Step 1: Verifying PAT access to base appecxe8XTHF7yA5a...
[Airtable] ✓ Step 1 passed: PAT can access base "..." (appecxe8XTHF7yA5a)
[Airtable] Step 2: Checking existing fields in table tblfvnRHv6McCSwIR...
[Airtable] Found X existing fields in table
```

Instead of:
```
[Airtable] ❌ Failed to fetch table schema: HTTP 404
```

