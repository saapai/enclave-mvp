# Fix: Authentication Required Error

## The Error

```
AUTHENTICATION_REQUIRED
Authentication required
```

## Common Causes

### 1. API Key Not Set or Empty

**Check:** Is `AIRTABLE_API_KEY` actually set in Vercel?

**Fix:**
1. Go to Vercel → Your Project → Settings → Environment Variables
2. Verify `AIRTABLE_API_KEY` exists and has a value
3. Click the eye icon to reveal the value (should start with `pat_`)

### 2. Whitespace in API Key

**Check:** The API key might have leading/trailing spaces.

**Fix:**
- Copy the token again from Airtable
- Paste it carefully without extra spaces
- Update in Vercel and redeploy

### 3. Using Old API Key Instead of PAT

**Check:** Does your `AIRTABLE_API_KEY` start with `pat_`?

**Fix:**
1. Create a new Personal Access Token:
   - Go to https://airtable.com/create/tokens
   - Create token with required scopes
   - Copy the token (starts with `pat_`)
2. Update `AIRTABLE_API_KEY` in Vercel
3. Redeploy

### 4. Invalid Token Format

**Check:** The token should look like: `pat_xxxxxxxxxxxx`

**Fix:**
- Make sure you copied the entire token
- No extra characters, quotes, or line breaks
- Should be one continuous string

### 5. Token Revoked or Expired

**Check:** If you recently regenerated the token in Airtable, the old one is invalid.

**Fix:**
- Create a new token in Airtable
- Update Vercel immediately
- Old tokens are revoked when you create new ones

## Quick Diagnostic

The code now logs helpful warnings if:
- API key doesn't start with `pat_`
- API key is missing

Check your logs for these messages after redeploying.

## Verification Steps

1. ✅ `AIRTABLE_API_KEY` exists in Vercel
2. ✅ Value starts with `pat_`
3. ✅ No whitespace (trimmed in code, but check manually)
4. ✅ Token has required scopes in Airtable
5. ✅ Token has access to the correct base
6. ✅ Redeployed after updating

## Test After Fix

After updating and redeploying, try responding to a poll again. The error should change if authentication is fixed.

