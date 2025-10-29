# Debug: API Key Authentication Issue

## The Problem

- ✅ Your Vercel env var shows `AIRTABLE_API_KEY` starts with `pat_`
- ❌ But the code logs say it doesn't start with `pat_`
- ❌ Authentication still fails

## Possible Causes

### 1. Deployment Not Updated

**Most Likely:** The code was deployed before you updated the env var, or Vercel hasn't picked up the change yet.

**Fix:**
1. Go to Vercel → Your Project → Deployments
2. Trigger a new deployment (or wait for auto-deploy from git push)
3. Check the deployment logs to ensure env vars are loaded

### 2. Hidden Characters or Truncation

**Check:** The token might be incomplete or have special characters.

**Fix:**
1. In Vercel, click the "eye" icon to reveal the full value
2. Copy the entire token
3. Verify it's complete (should be quite long, ~50+ characters)
4. Paste it fresh into Vercel (delete and re-add)
5. Make sure no quotes or extra spaces

### 3. Environment-Specific Variable

**Check:** Is the variable set for the correct environment?

**Fix:**
1. In Vercel env vars, check the environment dropdown
2. Make sure it's set for "Production" (or whichever environment is deployed)
3. Set it to "All Environments" to be safe

### 4. Cached Build

**Check:** Vercel might be using a cached build.

**Fix:**
1. Go to Vercel → Settings → Build & Development Settings
2. Clear build cache
3. Redeploy

## After Next Deployment

The code now logs:
- First 10 characters of the API key (for debugging)
- Length of the key
- Warning if it doesn't start with `pat_`

Check your deployment logs for:
```
[Airtable] API key preview: "patThE0enp..." (length: XX)
```

This will show what the code is actually reading.

## Quick Test

After redeploying, send a poll response. The logs should show:
1. The API key preview (first 10 chars)
2. Whether it starts with `pat_`
3. Better error messages if auth still fails

