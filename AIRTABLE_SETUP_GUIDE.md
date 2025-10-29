# Airtable Setup Guide

## Quick Setup Steps

### 1. Get Your Airtable API Key

1. Go to https://airtable.com/account
2. Scroll to "Personal access tokens"
3. Create a new token with these scopes:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read` (for Metadata API field creation)
4. Copy the token (starts with `pat_`)

### 2. Create Your Base and Table

1. Create a new base (or use existing)
2. Create a table (e.g., "Enclave RSVP")
3. **CRITICAL**: Create these required fields:
   - `phone number` (Single line text) - Used to find/update records
   - `Person` (Single line text) - Stores person's name

### 3. Get Your Base ID and Table Name/ID

**Base ID:**
- Open your Airtable base
- Look at the URL: `https://airtable.com/appXXXXXXXXXXXXXX/...`
- Base ID is `appXXXXXXXXXXXXXX`

**Table Name:**
- Use the exact name as it appears in Airtable (case-sensitive!)
- Example: `Enclave RSVP`

**Table ID (for Metadata API - optional but recommended):**
- Click on the table
- Look at the URL: `https://airtable.com/appXXXXXXXXXXXXXX/tblYYYYYYYYYYYYYYY/...`
- Table ID is `tblYYYYYYYYYYYYYYY`

### 4. Configure Environment Variables

Add to your `.env.local`:

```env
AIRTABLE_API_KEY=pat_your_token_here
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TABLE_ID=tblYYYYYYYYYYYYYYY  # Optional but recommended
AIRTABLE_TABLE_NAME=Enclave RSVP  # Must match exactly
```

### 5. Test Your Configuration

Run the diagnostic script:

```bash
cd /Users/gopalakrishnapai/Documents/enclave/enclave-mvp
node scripts/test-airtable.js
```

This will:
- ✅ Verify API key permissions
- ✅ Check base access
- ✅ Test table access
- ✅ Verify required fields exist
- ✅ Test search/upsert functionality

## Common Issues & Fixes

### Issue: "Invalid permissions, or the requested model was not found"

**Possible causes:**

1. **API Key doesn't have access to the base**
   - Solution: Share the base with the workspace/user that owns the API key
   - Or create a new API key for the correct workspace

2. **Table name doesn't match exactly**
   - Solution: Check spelling, capitalization, spaces
   - The table name must match EXACTLY (case-sensitive)

3. **Required fields don't exist**
   - Solution: Create these fields in Airtable:
     - `phone number` (Single line text)
     - `Person` (Single line text)

4. **Base ID is incorrect**
   - Solution: Get the correct Base ID from the URL

### Issue: Field "phone number" not found

- Create a field named exactly `phone number` (case-sensitive)
- Type: Single line text

### Issue: Metadata API fails

- Your API key needs `schema.bases:read` scope
- If you can't add that scope, the system will fall back to manual field creation
- You can create poll fields manually in Airtable when needed

## Field Creation Flow

When a poll is sent:

1. System tries to create 3 fields via Metadata API:
   - `{poll_question}_Question` (Single line text)
   - `{poll_question}_Response` (Single select: Yes, No, Maybe)
   - `{poll_question}_Notes` (Multiline text)

2. If Metadata API fails:
   - System logs the field names that need to be created manually
   - You can create them in Airtable later
   - Responses will still be recorded to existing fields

## Verification Checklist

- [ ] API key created with correct scopes
- [ ] Base ID copied correctly from URL
- [ ] Table name matches exactly (case-sensitive)
- [ ] `phone number` field exists
- [ ] `Person` field exists
- [ ] Run `node scripts/test-airtable.js` - all tests pass

