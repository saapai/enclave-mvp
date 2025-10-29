# Fix: Field Name Mismatch

## The Current Error

```
Unknown field names: a phone number
```

## The Problem

Your Vercel environment variables are set to:
- `AIRTABLE_PHONE_FIELD=A phone number` ❌
- `AIRTABLE_PERSON_FIELD=A Person` ❌

But your actual Airtable table has:
- Field name: `phone number` ✅ (no "A" prefix)
- Field name: `Person` ✅ (no "A" prefix)

## The Fix

1. **Go to Vercel Dashboard** → Your Project → Settings → Environment Variables

2. **Update these two variables:**

   **Change:**
   ```
   AIRTABLE_PHONE_FIELD=A phone number
   ```
   
   **To:**
   ```
   AIRTABLE_PHONE_FIELD=phone number
   ```
   
   **And change:**
   ```
   AIRTABLE_PERSON_FIELD=A Person
   ```
   
   **To:**
   ```
   AIRTABLE_PERSON_FIELD=Person
   ```

3. **Make sure `AIRTABLE_TABLE_NAME` is set to:**
   ```
   AIRTABLE_TABLE_NAME=Enclave
   ```

4. **Redeploy** your application

## Verification

After updating, the fields should match exactly:
- ✅ `phone number` (lowercase 'p', space, lowercase 'n')
- ✅ `Person` (capital 'P', rest lowercase)
- ✅ `Enclave` (table name)

The exact spelling, capitalization, and spaces matter!

