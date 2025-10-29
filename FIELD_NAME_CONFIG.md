# Airtable Field Name Configuration

## Quick Fix for Your Setup

Based on your Airtable screenshot, your fields are:
- `A phone number` (not `phone number`)
- `A Person` (not `Person`)

## Solution: Add to Vercel Environment Variables

Add these two variables to match your actual Airtable field names:

```env
AIRTABLE_PHONE_FIELD=A phone number
AIRTABLE_PERSON_FIELD=A Person
```

## Steps:

1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add:
   - `AIRTABLE_PHONE_FIELD` = `A phone number`
   - `AIRTABLE_PERSON_FIELD` = `A Person`
4. Redeploy your application

## Alternative: Rename Fields in Airtable

If you prefer, you can rename your Airtable fields to match the defaults:
- Rename `A phone number` → `phone number`
- Rename `A Person` → `Person`

Either approach works - just make sure the field names match between your code and Airtable!

## Verification

After setting the environment variables, the system will:
- ✅ Search for records using `{A phone number}` instead of `{phone number}`
- ✅ Store names in `A Person` field instead of `Person`
- ✅ Create new records with the correct field names

The diagnostic script will also check for these exact field names:
```bash
node scripts/test-airtable.js
```

