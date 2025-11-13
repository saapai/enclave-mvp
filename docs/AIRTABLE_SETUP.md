# Airtable Setup for SMS Polls

This guide walks you through setting up Airtable integration for recording SMS poll responses.

## 📋 Overview

When someone responds to an SMS poll, their answer is automatically recorded in Airtable with:
- **Person**: Their name (collected on first contact)
- **phone number**: Their phone number (unique identifier)
- **[Poll Question] Response**: Their Yes/No/Maybe answer
- **[Poll Question] Notes**: Any additional context they provided

## 🎯 Step 1: Create Airtable Base

1. Go to [airtable.com](https://airtable.com) and sign in
2. Click **"Add a base"** → **"Start from scratch"**
3. Name it: **"Enclave RSVP"** (or whatever you prefer)
4. You'll see a default table called **"Table 1"** - that's fine!

## 🔧 Step 2: Set Up Initial Fields

Airtable will auto-create fields when the first poll response comes in, but you should create these two fields manually:

1. **Person** (Single line text)
   - Click the **"+"** to add a field
   - Choose **"Single line text"**
   - Name it: `Person`

2. **phone number** (Single line text)
   - Click **"+"** again
   - Choose **"Single line text"**  
   - Name it: `phone number`

**Note**: Poll-specific fields like "active meeting Response" and "active meeting Notes" will be created automatically when the first poll is sent!

## 🔑 Step 3: Get Your API Credentials

### 3a. Get API Key

1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens)
2. Click **"Create new token"**
3. Name it: `Enclave SMS Integration`
4. Under **Scopes**, select:
   - ✅ `data.records:read`
   - ✅ `data.records:write`
   - ✅ `schema.bases:read`
5. Under **Access**, click **"Add a base"** and select your **"Enclave RSVP"** base
6. Click **"Create token"**
7. **Copy the token** - it starts with `pat...`
   - ⚠️ Save this somewhere safe! You won't see it again

### 3b. Get Base ID

1. Go to your Airtable base
2. Look at the URL: `https://airtable.com/appXXXXXXXXXXXXXX/...`
3. Copy the part that starts with `app` (e.g., `appecxe8XTHF7yA5a`)

### 3c. Get Table Name

- If you kept the default name, it's: `Table 1`
- If you renamed it, use that name exactly (case-sensitive!)

### 3d. Get Public Results URL (Optional but Recommended)

1. In your Airtable base, click **"Share"** (top right)
2. Under **"Shared base link"**, toggle **"Turn on"**
3. Click **"Private"** → Change to **"Anyone with the link can view"**
4. **Copy the share link** (e.g., `https://airtable.com/appXXXX/shrYYYY`)
5. This link will be included in SMS responses so people can see poll results!

## 🔐 Step 4: Add to Environment Variables

### For Local Development:

Create `.env.local` in your project root:

```bash
# Copy from your Airtable setup (use your own values; do not commit secrets)
AIRTABLE_API_KEY=pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=app_xxxxxxxxxxxxxxx
AIRTABLE_TABLE_NAME=Enclave RSVP
AIRTABLE_PUBLIC_RESULTS_URL=https://airtable.com/appXXXXXXXXXXXXXX/shrYYYYYYYYYYYYYY
```

**Note**: Replace with YOUR actual values!

### For Production (Vercel):

1. Go to your Vercel project dashboard
2. Click **"Settings"** → **"Environment Variables"**
3. Add each variable:
   - `AIRTABLE_API_KEY`: `pat...` (your API key)
   - `AIRTABLE_BASE_ID`: `app...` (your base ID)
   - `AIRTABLE_TABLE_NAME`: `Enclave RSVP` (or your table name)
   - `AIRTABLE_PUBLIC_RESULTS_URL`: `https://airtable.com/...` (your share link)
4. Click **"Save"**
5. Redeploy your app

## ✅ Step 5: Test It!

1. **Restart your dev server** (if running locally):
   ```bash
   npm run dev
   ```

2. **Send a test poll via SMS**:
   ```
   You: "i want to make a poll"
   Bot: "what would you like to ask in the poll?"
   You: "if people are coming to active meeting"
   Bot: "okay here's what the poll will say: yo are you coming to active meeting..."
   You: "send it"
   Bot: "sent poll to X people 📊"
   ```

3. **Check your Airtable**:
   - You should see new fields created automatically:
     - `active meeting Response`
     - `active meeting Notes`
   - When someone responds, their row will populate!

4. **Respond to the poll**:
   ```
   You: "yes"
   Bot: "Thanks [YourName]! Recorded: Yes

   View results: https://airtable.com/..."
   ```

5. **Check Airtable again** - you should see your response recorded!

## 🎨 Step 6: Customize Your Base (Optional)

### Add Views:
- **"Pending Responses"**: Filter by Response = empty
- **"Yes Responses"**: Filter by Response = "Yes"
- **"No Responses"**: Filter by Response = "No"

### Add Charts:
1. Click **"Views"** → **"Form view"** or **"Gallery"**
2. Visualize responses in real-time!

### Add Automations:
1. Click **"Automations"** in top right
2. Set up notifications when someone responds
3. Send email summaries, Slack messages, etc.

## 🔍 Troubleshooting

### "Airtable not configured" in logs
- Check that all 4 env variables are set
- Restart your server after adding env variables
- For Vercel: redeploy after adding env vars

### "Could not find table"
- Make sure `AIRTABLE_TABLE_NAME` matches exactly (case-sensitive!)
- Default is `Table 1` (with a space!)

### "Permission denied"
- Make sure your API token has `data.records:write` scope
- Verify the token has access to your specific base

### Responses not showing up
- Check Vercel logs or local terminal for errors
- Verify phone numbers are in E.164 format (+14089133065)
- Make sure the poll was sent (check "sent poll to X people" message)

## 📱 How It Works

1. **Poll Creation**: System creates dynamic fields in Airtable:
   - `[Poll Question] Response` (e.g., "active meeting Response")
   - `[Poll Question] Notes` (e.g., "active meeting Notes")

2. **Response Recording**: When someone texts back:
   - Looks up their row by phone number
   - Creates row if it doesn't exist
   - Updates Person field with their name
   - Records response in the poll-specific field

3. **Multiple Polls**: Each poll gets its own set of fields:
   - Poll 1: "active meeting Response", "active meeting Notes"
   - Poll 2: "study hall Response", "study hall Notes"
   - All in the same table, same people!

## 🎉 That's It!

Your Airtable is now integrated with your SMS poll system. Every poll response will be automatically recorded with the person's name, phone, answer, and any notes they provide!

---

**Need help?** Check the [main README](../README.md) or create an issue on GitHub.


