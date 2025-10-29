# Verify Your Personal Access Token

## Current Issue

The logs show your token is only **17 characters**, but PATs should be **40-60 characters**.

## Step-by-Step Verification

### 1. Check What's Actually in Vercel

1. Go to Vercel → Your Project → Settings → Environment Variables
2. Find `AIRTABLE_API_KEY`
3. Click the **eye icon** (👁️) to reveal the value
4. **Count the characters** - it should be 40-60 characters long
5. Note what it starts with (should be `pat_` in lowercase)

### 2. Get the FULL Token from Airtable

**Important:** Airtable tokens are LONG - make sure you get the entire thing!

1. Go to https://airtable.com/create/tokens
2. Find your token (or create a new one)
3. **DO NOT** copy from the preview - it might be truncated!
4. Instead:
   - Click **"Reveal"** button to see the full token
   - OR click **"Copy"** button directly (not manual selection)
5. The token should look like:
   ```
   pat_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEf
   ```
   - Starts with lowercase `pat_`
   - Followed by ~40+ random characters
   - Total length: 40-60 characters

### 3. Update Vercel Properly

1. In Vercel, click on `AIRTABLE_API_KEY`
2. Click "Edit" or delete the old value
3. Paste the **ENTIRE** token you just copied
4. **Check the length** in the input field (should be 40-60 chars)
5. Save

### 4. Force a New Deployment

**Critical:** Vercel caches builds. After updating the env var:

1. Go to Vercel → Deployments
2. Click the "..." menu on the latest deployment
3. Click **"Redeploy"** (or trigger a new deployment)
4. This ensures the new env var is loaded

### 5. Test Again

After redeploying, send another poll response. Check the logs for:

```
[Airtable] API key preview: "pat_xxxxx..." (length: 45)
```

If the length is still 17, the deployment is still using the old value or the token is still incomplete in Vercel.

## Quick Check

After updating, you can verify by checking:
- Token length in Vercel (should be 40-60)
- Token starts with lowercase `pat_`
- A new deployment was triggered after updating

