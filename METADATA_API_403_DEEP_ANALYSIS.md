# Deep Analysis: Metadata API 403 Error

## Current Situation

✅ **What Works:**
- PAT format is valid (starts with `pat`, 82 chars)
- PAT authentication works (`/v0/meta/bases` listing succeeds)
- Base `appecxe8XTHF7yA5a` ("Enclave") IS found in accessible bases
- PAT has correct scopes: `schema.bases:read`, `schema.bases:write`, `data.records:read`, `data.records:write`

❌ **What Fails:**
- Metadata API endpoint `/v0/meta/bases/{baseId}` returns **HTTP 403**
- Error: "Invalid permissions, or the requested model was not found"

## Root Cause Analysis

### Key Finding

**The base is accessible via listing, but NOT via Metadata API endpoint.**

This indicates the Metadata API has **DIFFERENT permission requirements** than the base listing endpoint.

### Research Findings

#### 1. **Workspace Role Requirement** (Most Likely)

Metadata API may require the **Airtable account** (not just PAT) to have:
- **Creator** or **Owner** role on the workspace
- NOT just "Editor" or "Commenter" on the base

**How to Check:**
1. Go to your Airtable workspace
2. Check your role: Settings → Workspace → Members
3. You should see: "Owner" or "Creator" next to your account
4. If you see "Editor", that's the issue

**Solution:**
- Ask workspace owner to promote you to Creator/Owner
- OR have workspace owner create the PAT

#### 2. **Base Permissions vs Metadata API**

Metadata API specifically modifies **base schema** (structure), which may require:
- Base-level editing permissions (not just data editing)
- Schema modification rights
- Different from record-level read/write permissions

**Check:**
- Go to base → Share → Check your base role
- Must be "Creator" or "Owner" (not just "Editor" on records)

#### 3. **Workspace-Level Metadata API Restrictions**

Some workspaces may have restrictions on:
- Schema modifications via API
- Metadata API access
- API-based field creation

**Solution:**
- Check workspace settings for API restrictions
- Contact workspace admin to enable Metadata API

#### 4. **IP Restrictions**

If workspace has IP whitelisting:
- Vercel server IPs may not be whitelisted
- Metadata API might have stricter IP checks than Records API

**Solution:**
- Check workspace → Settings → Security → IP Restrictions
- Whitelist Vercel IPs or remove restrictions

#### 5. **Account vs PAT Permissions**

The **Airtable account** that created the PAT must have:
- Base ownership OR
- Workspace Creator/Owner role

PAT scopes alone aren't enough if the account lacks base/workspace permissions.

## Diagnostic Steps

### Step 1: Verify Your Account Role

1. Go to Airtable → Your Workspace
2. Click "Members" or "Team"
3. Find your account
4. Note your role: **Owner**, **Creator**, or **Editor**

**Expected:** Owner or Creator  
**If Editor:** This is likely the problem

### Step 2: Verify Base Permissions

1. Open base `appecxe8XTHF7yA5a` ("Enclave")
2. Click "Share" button
3. Check your base role:
   - **Creator** (full access) ✅
   - **Owner** (full access) ✅
   - **Editor** (may not have schema permissions) ⚠️

**Expected:** Creator or Owner

### Step 3: Test Direct API Call

Run this curl command to test Metadata API directly:

```bash
curl -X GET "https://api.airtable.com/v0/meta/bases/appecxe8XTHF7yA5a" \
  -H "Authorization: Bearer YOUR_PAT_HERE" \
  -H "Content-Type: application/json"
```

If this returns 403, it's definitely a permissions issue, not a code issue.

### Step 4: Check Workspace Settings

1. Workspace → Settings → Security
2. Check for:
   - IP Restrictions
   - API Restrictions
   - Metadata API limitations

## Solutions (In Order of Likelihood)

### Solution 1: Upgrade Account Role (Most Likely Fix)

**If you're "Editor" on workspace or base:**

1. Contact workspace owner/admin
2. Ask them to:
   - Promote you to **Creator** or **Owner** on the workspace, OR
   - Grant you **Creator** access on the base
3. Once upgraded, test Metadata API again

### Solution 2: Create PAT as Workspace Owner

**If you can't be promoted:**

1. Have the workspace **Owner** create a PAT
2. Same scopes: `schema.bases:read`, `schema.bases:write`, `data.records:read`, `data.records:write`
3. Update `AIRTABLE_API_KEY` in Vercel

### Solution 3: Remove IP Restrictions

**If workspace has IP whitelisting:**

1. Workspace → Settings → Security
2. Find IP Restrictions
3. Either:
   - Add Vercel server IP ranges, OR
   - Temporarily disable restrictions for testing

### Solution 4: Check Base Sharing Settings

**Ensure base sharing allows schema modifications:**

1. Base → Share
2. Your role should be **Creator** (not "Editor" or "Commenter")
3. If not, workspace owner needs to change it

### Solution 5: Contact Airtable Support

**If none of the above work:**

This may be a workspace-level restriction or bug. Contact Airtable Support with:
- Your workspace ID
- Base ID: `appecxe8XTHF7yA5a`
- Error: "403 on Metadata API despite correct PAT scopes"
- Evidence: Base listing works but Metadata API fails

## Immediate Workaround

Until Metadata API access is resolved, **fields must be created manually:**

1. When a poll is sent, the system logs the field names needed:
   ```
   yo_is_ash_gay_Question_2025_10_29 (Single line text)
   yo_is_ash_gay_Response_2025_10_29 (Single select: Yes, No, Maybe)
   yo_is_ash_gay_Notes_2025_10_29 (Long text)
   ```

2. Create these fields manually in Airtable:
   - Go to your "Enclave" table
   - Add field → Type → Single line text (for Question)
   - Add field → Type → Single select → Options: Yes, No, Maybe (for Response)
   - Add field → Type → Long text (for Notes)

3. Poll responses will still save once fields exist

## Verification Checklist

- [ ] Account role is **Owner** or **Creator** on workspace
- [ ] Base role is **Creator** or **Owner** (not just Editor)
- [ ] PAT has all 4 required scopes
- [ ] Base is listed when calling `/v0/meta/bases`
- [ ] Workspace has no IP restrictions (or Vercel IPs whitelisted)
- [ ] Direct curl test to Metadata API endpoint

## Expected Outcome After Fix

Once permissions are correct, you should see:

```
✓ Step 0: PAT authentication works! Found X accessible base(s)
✓ Target base "appecxe8XTHF7yA5a" found in accessible bases
✓ Step 1 passed: PAT can access base "Enclave" (appecxe8XTHF7yA5a)
✓ Step 2: Checking existing fields in table...
✓ Found X existing fields in table
✓ Created field: "..."
```

Instead of the 403 error.

