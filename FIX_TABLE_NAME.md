# Fix: Table Name Mismatch

## The Problem

Error: `Table "Enclave" not found`

Your Airtable setup:
- **Base name:** "Enclave RSVP"
- **Table name:** "Enclave" ← This is what you need!

## The Issue

The `AIRTABLE_TABLE_NAME` environment variable in Vercel is probably set to `"Enclave RSVP"` (the base name), but it should be `"Enclave"` (the actual table name inside the base).

## Quick Fix

1. **Go to Vercel Dashboard** → Your Project → Settings → Environment Variables

2. **Update `AIRTABLE_TABLE_NAME`:**
   - Current (wrong): `Enclave RSVP`
   - Correct: `Enclave`
   
   **Change it to:** `Enclave`

3. **Make sure you also have these set:**
   ```
   AIRTABLE_PHONE_FIELD=A phone number
   AIRTABLE_PERSON_FIELD=A Person
   ```

4. **Redeploy** (or wait for auto-deploy from git push)

## Verify in Airtable

1. Open your Airtable base
2. Look at the **tab name** at the top (not the base name)
3. You should see "Enclave" as the active table tab
4. The table name matches what you set in `AIRTABLE_TABLE_NAME`

## Test Script

After updating, you can test with:

```bash
node scripts/test-airtable-table.js "Enclave"
```

This will verify the table is accessible with that exact name.

