# Force Clean Deployment - Complete Guide

## Current Issue

✅ Token updated in Vercel 7 minutes ago  
❌ Deployment still using old 17-character token  
**Root Cause:** Vercel is serving a cached deployment with old environment variables

## Solution: Force a Fresh Deployment

### Method 1: Redeploy from Vercel Dashboard (Fastest)

1. Go to your Vercel dashboard
2. Click on your project
3. Go to **"Deployments"** tab
4. Find the **most recent deployment**
5. Click the **"..."** menu button
6. Click **"Redeploy"**
7. ✅ Make sure to check **"Use existing Build Cache"** is **UNCHECKED**
8. Click **"Redeploy"** to confirm

### Method 2: Trigger New Deployment via Git Push

1. Make a small change to force redeploy:
   ```bash
   cd /Users/gopalakrishnapai/Documents/enclave/enclave-mvp
   echo "# Force redeploy $(date)" >> README.md
   git add README.md
   git commit -m "Force redeploy with updated Airtable token"
   git push origin main
   ```

2. Wait for Vercel to automatically deploy (usually 2-3 minutes)

### Method 3: Clear Build Cache (Most Thorough)

1. Go to Vercel → Your Project → **Settings**
2. Scroll to **"Build & Development Settings"**
3. Find **"Build Cache"** section
4. Click **"Clear Build Cache"**
5. Go back to **Deployments** and trigger a new deployment

## Verification Steps

### Step 1: Check Deployment Status

1. Go to Vercel → Deployments
2. Wait for the new deployment to complete
3. Look for **green checkmark** and **"Ready"** status
4. Note the timestamp (should be after you triggered redeploy)

### Step 2: Check Environment Variables Are Loaded

After deployment completes:

1. Go to Vercel → Settings → Environment Variables
2. Verify `AIRTABLE_API_KEY` shows the updated timestamp (7m ago or newer)
3. Click the eye icon to confirm it starts with `patgMhC8...`

### Step 3: Test the SMS Bot

Send a poll response via SMS:

1. Text "Yes" to your Twilio number
2. Check the deployment logs (Vercel → Deployments → Latest → View Function Logs)
3. Look for this line:
   ```
   [Airtable] API key preview: "patgMhC8K..." (length: 45)
   ```
4. **Success indicator:** Length should be 40-60 (not 17!)

### Step 4: Verify Airtable Connection

If the length is correct, you should see:
```
✅ [Airtable] Searching for record...
✅ [Airtable] Creating record at: https://api.airtable.com/...
✅ [Polls] Created Airtable record for...
```

Instead of:
```
❌ [Airtable] Authentication required
```

## Why This Happens

Vercel's deployment process:

1. **Builds** your app with environment variables
2. **Caches** the build for faster deployments
3. **Serves** the cached build to users

When you update an env var:
- ❌ Existing deployments still use old values
- ❌ Cached builds may not pick up changes
- ✅ New deployments will use updated values

## Common Pitfalls

### 1. Multiple Environments
- Check if you updated **"Production"** environment
- Make sure it's not just set for "Preview" or "Development"
- Set to **"All Environments"** to be safe

### 2. API Key Format
- Should start with `patgMhC8...` (lowercase `pat`)
- Should be 40-60 characters
- No quotes, no spaces, no line breaks

### 3. Deployment Not Triggered
- Updating an env var **doesn't auto-deploy**
- You must manually trigger a new deployment
- Or push code to trigger auto-deploy

## Expected Results After Fix

After successful redeployment, logs should show:

```
[Airtable] API key preview: "patgMhC8K..." (length: 47)
[Airtable] Searching for record. Base: appecxe8XTHF7yA5a, Table: "Enclave"
[Airtable] Creating record at: https://api.airtable.com/v0/appecxe8XTHF7yA5a/Enclave
[Airtable] Fields to create: phone number, Person, when_is_futsal_Question_2025_10_29, when_is_futsal_Response_2025_10_29
✅ [Polls] Created Airtable record for 3853687238 (Saathvik)
```

## Still Not Working?

If after redeploying the length is still 17:

1. **Check the actual deployment that's running:**
   - Go to your live site
   - Check the deployment ID/timestamp
   - Compare it to the deployment you just triggered

2. **Try Method 3 (Clear Build Cache)** - most thorough

3. **Check for typos:**
   - Variable name: `AIRTABLE_API_KEY` (exact spelling)
   - No extra spaces in the variable name

4. **Delete and re-add the variable:**
   - Sometimes Vercel UI has issues
   - Delete `AIRTABLE_API_KEY` completely
   - Add it fresh with the full token
   - Redeploy

