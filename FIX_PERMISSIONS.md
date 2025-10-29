# Fix: Airtable Permissions Issue

## The Error

```
INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND
Invalid permissions, or the requested model was not found.
```

## Diagnosis

Your setup looks correct:
- ✅ Table name: "Enclave" 
- ✅ Field names: "phone number", "Person"
- ✅ Base ID: appecxe8XTHF7yA5a

The error is a **permissions issue** with your Airtable API key.

## Solution 1: Check API Key Scopes

1. Go to https://airtable.com/account
2. Find your Personal Access Token
3. Check it has these scopes:
   - ✅ `data.records:read`
   - ✅ `data.records:write`
   - ✅ `schema.bases:read` (optional, for Metadata API)

If any are missing, create a new token with all required scopes.

## Solution 2: Workspace vs Personal Token

If your token is **workspace-scoped**:

1. The base "Enclave RSVP" must be **shared** with that workspace
2. Or create a **Personal Access Token** (not workspace-scoped)

To check:
- Go to your base settings
- Share the base with the workspace that owns your API key
- Or create a new Personal Access Token (not workspace-scoped)

## Solution 3: Verify Base Access

Run this to test if your API key can access the base:

```bash
curl "https://api.airtable.com/v0/meta/bases" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

If the base `appecxe8XTHF7yA5a` is not in the list, your API key doesn't have access.

## Solution 4: Create New Personal Access Token

1. Go to https://airtable.com/account
2. Delete the old token (if workspace-scoped)
3. Create a **new Personal Access Token** with:
   - ✅ `data.records:read`
   - ✅ `data.records:write`
   - ✅ `schema.bases:read`
4. Update `AIRTABLE_API_KEY` in Vercel
5. Redeploy

## Quick Test

After updating, test with:

```bash
curl "https://api.airtable.com/v0/appecxe8XTHF7yA5a/Enclave?maxRecords=1" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

If this works, your API key has access. If it returns 401/403, the key needs updating.

