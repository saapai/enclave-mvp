# Fix: Incomplete API Token

## The Problem

Your API token is **incomplete**:
- ✅ Token length: **17 characters** (should be 40-60)
- ❌ Token starts with: `patThE0enp...` (should start with lowercase `pat_`)
- ❌ Token is truncated/incomplete

## The Solution

Your Personal Access Token in Vercel is **not the full token**. You need to:

### 1. Get the Full Token from Airtable

1. Go to https://airtable.com/create/tokens
2. Find your "Enclave RSVP" token (or create a new one)
3. **Copy the ENTIRE token** - it should be:
   - Start with lowercase `pat_`
   - 40-60 characters long
   - Example: `pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 2. Update Vercel

1. Go to Vercel → Your Project → Settings → Environment Variables
2. Click on `AIRTABLE_API_KEY`
3. **Delete the current value** (it's incomplete)
4. Paste the **FULL token** from Airtable
5. Make sure:
   - ✅ No quotes
   - ✅ No spaces
   - ✅ Complete token (starts with `pat_`, 40+ chars)
6. Save
7. **Redeploy** your application

### 3. Verify Token Format

After updating, the logs should show:
```
[Airtable] API key preview: "pat_xxxxx..." (length: 45)
```

If the length is still under 30, the token is still incomplete.

## How to Copy Token Properly

When copying from Airtable:
1. Click the "Copy" button (don't manually select)
2. Or use the "Reveal" button to see the full token
3. Make sure you get the entire string
4. A complete PAT looks like: `pat_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890`

## Common Mistakes

- ❌ Copying only part of the token
- ❌ Token gets cut off when pasting
- ❌ Extra spaces or line breaks
- ❌ Using an old/revoked token

After fixing, try responding to a poll again. The authentication should work!

