# Airtable Troubleshooting

## Error: "Invalid permissions, or the requested model was not found"

This error usually means one of these issues:

### 1. API Key Permissions

**Check:** Does your API key have access to the base?

**Solution:**
- Go to https://airtable.com/account
- Check your Personal Access Token scopes
- Ensure token has:
  - `data.records:read`
  - `data.records:write`
  - `schema.bases:read` (optional, for Metadata API)

**If token is workspace-scoped:**
- Share the base with that workspace
- Or create a Personal Access Token (not workspace-scoped)

### 2. Table Name Mismatch

**Check:** Does the table name match EXACTLY?

**Solution:**
- Table names are case-sensitive
- Check for extra spaces
- Use the exact name as shown in Airtable UI
- Common mistake: `"Enclave RSVP"` vs `"Enclave rsvp"` vs `"EnclaveRSVP"`

### 3. Missing Required Fields

**Check:** Do these fields exist?
- `phone number` (exact name, case-sensitive)
- `Person` (exact name, case-sensitive)

**Solution:**
1. Open your Airtable table
2. Create field: `phone number` (Single line text)
3. Create field: `Person` (Single line text)

### 4. Base ID Incorrect

**Check:** Is the Base ID correct?

**Solution:**
- Get Base ID from URL: `https://airtable.com/appXXXXXXXXXXXXXX/...`
- It should start with `app` followed by ~14 characters
- Copy the ENTIRE base ID

### 5. Field Names Don't Exist

**Check:** When recording a poll response, the system tries to write to fields like:
- `{poll_question}_Question`
- `{poll_question}_Response`
- `{poll_question}_Notes`

**Solution:**
- These fields are created automatically when a poll is sent
- If Metadata API fails, you'll need to create them manually
- Check logs for field names that need to be created

## Quick Diagnostic Steps

### Step 1: Run Test Script

```bash
node scripts/test-airtable.js
```

This will check:
- API key validity
- Base access
- Table access
- Required fields

### Step 2: Verify Environment Variables

Check your `.env.local`:

```env
AIRTABLE_API_KEY=pat_...  # Must start with "pat_"
AIRTABLE_BASE_ID=app_...  # Must start with "app"
AIRTABLE_TABLE_NAME=Exact Table Name  # Must match exactly
AIRTABLE_TABLE_ID=tbl_...  # Optional, starts with "tbl"
```

### Step 3: Manual Test in Airtable UI

1. Open your base
2. Check the table name matches `AIRTABLE_TABLE_NAME`
3. Verify `phone number` and `Person` fields exist
4. Try creating a test record manually

### Step 4: Test API Access

You can test the API directly:

```bash
# Test 1: List your bases
curl "https://api.airtable.com/v0/meta/bases" \
  -H "Authorization: Bearer pat_YOUR_API_KEY"

# Test 2: Access your table
curl "https://api.airtable.com/v0/app_YOUR_BASE_ID/Your%20Table%20Name?maxRecords=1" \
  -H "Authorization: Bearer pat_YOUR_API_KEY"
```

## Common Field Name Issues

When recording poll responses, the system looks for fields that were created when the poll was sent. If you see errors about missing fields:

1. **Check the poll logs** - They show the exact field names needed
2. **Create fields manually** - Add them to your Airtable table
3. **Field name format:**
   - Question: `{sanitized_question}_Question_YYYY_MM_DD`
   - Response: `{sanitized_question}_Response_YYYY_MM_DD`
   - Notes: `{sanitized_question}_Notes_YYYY_MM_DD`

Example:
- Poll question: "When is futsal?"
- Fields created: `when_is_futsal_Question_2025_10_29`, etc.

## Still Having Issues?

1. **Check the exact error message** in logs
2. **Verify all environment variables** are set correctly
3. **Run the diagnostic script** and share the output
4. **Try creating a record manually** in Airtable UI first
5. **Check API key scopes** - might need personal token, not workspace token

