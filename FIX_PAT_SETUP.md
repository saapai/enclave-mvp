# Fix: Use Personal Access Token (PAT) Instead of API Key

## The Problem

1. You're using an old **API Key** instead of a **Personal Access Token (PAT)**
2. The poll-specific fields (`yo_is_ash_gay_Question_2025_10_29`) aren't being created
3. PAT needs `schema.bases:write` scope to create fields dynamically

## Solution: Create and Configure PAT

### Step 1: Create Personal Access Token

1. Go to your Airtable Builder Hub: https://airtable.com/create/tokens
2. Click **"Create new token"**
3. **Name:** "Enclave RSVP" (or whatever you want)
4. **Scopes** - Select ALL of these:
   - ✅ `data.records:read` - See the data in records
   - ✅ `data.records:write` - Create, edit, and delete records
   - ✅ `data.recordComments:write` - Create, edit, and delete record comments
   - ✅ `schema.bases:read` - See the structure of a base
   - ✅ `schema.bases:write` - **EDIT the structure of a base (CREATE fields)** ← CRITICAL!
5. **Access:** 
   - Select "All current and future bases" OR
   - Select your specific base "Enclave RSVP"
6. Click **"Save changes"**
7. **Copy the token** (starts with `pat_...`) - you'll only see it once!

### Step 2: Update Vercel Environment Variables

1. Go to Vercel → Your Project → Settings → Environment Variables
2. **Update `AIRTABLE_API_KEY`:**
   - Old value: Your old API key
   - New value: Your new PAT (starts with `pat_`)
3. **Verify `AIRTABLE_TABLE_ID` is set:**
   - Get Table ID from Airtable URL: `https://airtable.com/appecxe8XTHF7yA5a/tblXXXXXXXXXXXXXX/...`
   - The Table ID is `tblXXXXXXXXXXXXXX`
   - Set `AIRTABLE_TABLE_ID=tblXXXXXXXXXXXXXX` in Vercel
4. **Redeploy** your application

### Step 3: Verify All Environment Variables

Make sure you have all of these in Vercel:

```env
AIRTABLE_API_KEY=pat_...                    # Your new PAT token
AIRTABLE_BASE_ID=appecxe8XTHF7yA5a          # Base ID
AIRTABLE_TABLE_ID=tblXXXXXXXXXXXXXX         # Table ID (CRITICAL for field creation!)
AIRTABLE_TABLE_NAME=Enclave                 # Table name
AIRTABLE_PHONE_FIELD=phone number           # Field name (lowercase)
AIRTABLE_PERSON_FIELD=Person                # Field name (capital P)
```

## Why This Fixes It

1. **PAT has `schema.bases:write` scope** → Can create fields automatically
2. **PAT works with Metadata API** → System can create fields when poll is sent
3. **Table ID needed** → Metadata API requires `AIRTABLE_TABLE_ID` (not just table name)

## After Updating

When you send the next poll:
1. System will create fields automatically via Metadata API
2. Fields will exist before users respond
3. Responses will write successfully to Airtable

## Quick Test

After updating, you can test field creation:

```bash
# The next poll sent should log:
[Polls] ✓ Created 3 Airtable fields: yo_is_ash_gay_Question_2025_10_29, ...
```

If you see this, fields are being created! 🎉

