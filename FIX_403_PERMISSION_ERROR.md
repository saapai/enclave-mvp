# Fix 403 Permission Error - PAT Cannot Access Base

## The Issue

You're getting **HTTP 403** which means:
- ✅ PAT format is correct (starts with `pat`, 82 chars)
- ✅ Base ID exists (`appecxe8XTHF7yA5a`)
- ❌ PAT doesn't have permission to access this base

## Solution Steps

### Option 1: Verify & Save PAT in Airtable (Quick Fix)

1. Go to https://airtable.com/create/tokens
2. Click on your "enclave" token
3. **Verify settings:**
   - Scopes: ✅ All 4 scopes enabled
   - Access: ✅ "All current and future bases" is selected
4. **Click "Save changes"** (even if nothing changed - this refreshes permissions)
5. Copy the token again (first 10 chars to verify it's the same)

### Option 2: Create Fresh PAT (Most Reliable)

1. Go to https://airtable.com/create/tokens
2. **Create a NEW token:**
   - Name: "enclave-production"
   - Scopes: Select all 4 required scopes
   - Access: Select "All current and future bases in all current and future workspaces"
3. **Copy the token** (you'll only see it once!)
4. **Update Vercel:**
   - Go to Vercel → Settings → Environment Variables
   - Update `AIRTABLE_API_KEY` with the NEW token
   - **Make sure there's no whitespace before/after**
5. **Save and redeploy**

### Option 3: Check Workspace Access

If your base is in a specific workspace:
1. Go to https://airtable.com/create/tokens
2. Edit your PAT
3. Under "Access", make sure you see:
   - Either "All current and future bases"
   - OR your specific workspace listed
4. If the workspace/base isn't there, you may need workspace-level permissions

### Verification

After updating, send another poll. You should see:
```
✓ Step 1 passed: PAT can access base "..." (appecxe8XTHF7yA5a)
✓ Step 2: Checking existing fields in table...
✓ Found X existing fields in table
```

Instead of:
```
❌ CANNOT ACCESS BASE: Invalid permissions... (HTTP 403)
```

## Why This Happens

- Token was created before the base existed
- Token permissions weren't saved properly
- Token in Vercel is different from Airtable
- Workspace-level restrictions
- Token needs to be refreshed after permission changes

## Most Common Fix

**Create a fresh PAT with identical settings** - this ensures all permissions are properly set from the start.

