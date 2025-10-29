# Airtable Integration - Complete Setup Checklist

## Current Status Analysis

Based on your logs and screenshots:

✅ **What's Working:**
- Airtable Personal Access Token created
- Token updated in Vercel (7m ago)
- Token is correct format: `patgMhC8KqJpBUHBq.4e8ae6d1d5f08...`
- Token length appears correct (40-60 chars)
- All field names configured correctly

❌ **What's Not Working:**
- Deployment using old 17-character token
- Authentication failing with `AUTHENTICATION_REQUIRED`

🎯 **Root Cause:** Vercel deployment hasn't picked up the new environment variable

---

## Complete Setup Checklist

### ✅ Phase 1: Airtable Configuration

- [x] Personal Access Token created
- [x] Token has correct scopes:
  - [x] `data.records:read`
  - [x] `data.records:write`
  - [x] `schema.bases:read`
  - [x] `schema.bases:write` (for field creation)
- [x] Token has access to "Enclave RSVP" base
- [x] Token starts with `pat` (lowercase)
- [x] Token is 40-60 characters long

### ✅ Phase 2: Airtable Table Setup

- [x] Base: "Enclave RSVP" (ID: `appecxe8XTHF7yA5a`)
- [x] Table: "Enclave"
- [x] Field: `phone number` (Single line text)
- [x] Field: `Person` (Single line text)

### ✅ Phase 3: Vercel Environment Variables

All variables set correctly:

- [x] `AIRTABLE_API_KEY` = `patgMhC8KqJpBUHBq.4e8ae6d1d5f08...` (updated 7m ago)
- [x] `AIRTABLE_BASE_ID` = `appecxe8XTHF7yA5a`
- [x] `AIRTABLE_TABLE_NAME` = `Enclave`
- [x] `AIRTABLE_TABLE_ID` = `tblXXXXXXXXXXXXXX` (for Metadata API)
- [x] `AIRTABLE_PHONE_FIELD` = `phone number`
- [x] `AIRTABLE_PERSON_FIELD` = `Person`

### ❌ Phase 4: Deployment (NEEDS ACTION)

- [ ] **Trigger new deployment** after env var update
- [ ] Verify deployment completed successfully
- [ ] Check logs show correct token length (40-60, not 17)
- [ ] Test SMS poll response
- [ ] Verify Airtable record created

---

## Action Required: Force Redeployment

The environment variables are configured correctly, but the **active deployment** is using the old values.

### Option A: Quick Redeploy (Recommended)

```bash
# In your terminal
cd /Users/gopalakrishnapai/Documents/enclave/enclave-mvp
echo "# Redeploy $(date)" >> README.md
git add README.md
git commit -m "Trigger redeploy with updated Airtable token"
git push origin main
```

### Option B: Manual Redeploy via Vercel UI

1. Go to Vercel Dashboard → Deployments
2. Click "..." on latest deployment → "Redeploy"
3. Uncheck "Use existing Build Cache"
4. Click "Redeploy"

---

## Verification After Redeployment

### 1. Check Deployment Logs

After deployment completes, check logs for:

```
✅ [Airtable] API key preview: "patgMhC8K..." (length: 47)
   (NOT: "patThE0enp..." (length: 17))
```

### 2. Test SMS Response

Send "Yes" to your Twilio number, check for:

```
✅ [Airtable] Searching for record...
✅ [Airtable] Creating record...
✅ [Polls] Created Airtable record for 3853687238
```

### 3. Verify in Airtable

Open your Airtable base → "Enclave" table:

```
✅ New row created with:
   - phone number: +13853687238
   - Person: Saathvik
   - Response: Yes
```

---

## Troubleshooting Matrix

| Symptom | Cause | Fix |
|---------|-------|-----|
| Length still 17 | Deployment not updated | Trigger new deployment |
| "AUTHENTICATION_REQUIRED" | Old token in deployment | Force redeploy, clear cache |
| "Table not found" | Table name mismatch | Verify `AIRTABLE_TABLE_NAME=Enclave` |
| "Unknown field" | Field doesn't exist | Create fields in Airtable manually |
| "Invalid permissions" | Token lacks scopes | Recreate token with all scopes |

---

## Expected Timeline

1. ⏱️ **Now:** Push code or trigger redeploy (1 minute)
2. ⏱️ **+2-3 min:** Deployment completes on Vercel
3. ⏱️ **+4 min:** Test SMS response
4. ⏱️ **+5 min:** Verify record in Airtable

**Total:** ~5 minutes from redeployment to working Airtable integration

---

## Success Criteria

✅ All of these should be true:

1. Logs show token length 40-60 (not 17)
2. No "AUTHENTICATION_REQUIRED" errors
3. SMS poll responses create Airtable records
4. Records visible in Airtable table
5. All fields populated correctly

