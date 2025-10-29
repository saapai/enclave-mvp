# Conversational Polls Guide

## 🎯 What It Does

Allows users to create, edit, and send polls via SMS with intelligent response collection, name tracking, and Airtable integration.

## 🚀 How It Works

### Poll Creation Flow (Mirrors Announcements)

1. **Initiate**: Text "create a poll about active meeting tonight at 7"
2. **Draft**: Agent generates conversational question: "yo are you coming to active meeting tonight at 7"
3. **Edit**: Reply "be more urgent" or provide exact text
4. **Send**: Reply "send it" to blast to everyone in the group

### Response Collection Flow

1. **Poll Blast**: Recipients receive conversational message (e.g. "yo are you coming to active meeting tonight at 7")
2. **Name Collection** (first time only): 
   - If no name on file, agent asks: "What's your name?"
   - User replies: "Saathvik"
   - Agent: "Thanks Saathvik! Now reply with your response to the poll"
3. **Smart Response Parsing**:
   - User: "ya but im running 15 late"
   - Agent extracts:
     - **Response**: Yes
     - **Notes**: "running 15 late"
4. **Confirmation**: "Thanks Saathvik! Recorded: Yes (note: running 15 late)\n\nView results: [Airtable link]"

### Airtable Integration

Each poll creates dynamic fields in your Airtable:
- **Person**: Collected name (linked to phone)
- **Phone**: E.164 format
- **[Question] Response**: e.g. "active meeting tonight at 7 Response"
- **[Question] Notes**: e.g. "active meeting tonight at 7 Notes"

Rows are upserted by Person, so each person has one row that gets updated across polls.

## 📱 Usage Examples

### Basic Poll Creation

```
User: "create a poll about active meeting tonight at 7"

Bot: "okay here's what the poll will say:

yo are you coming to active meeting tonight at 7

reply 'send it' to send or reply to edit the message"

User: "send it"

Bot: "sent poll to 47 people 📊

view results: https://airtable.com/appecxe8XTHF7yA5a/shraFzSRHX35axIEl"
```

### Edit Poll Message

```
User: "make it more casual"

Bot: "updated:

yo u coming to active meeting tonight at 7?

reply 'send it' to send"

User: "actually say: yo pull up to active meeting at 7"

Bot: "updated:

yo pull up to active meeting at 7

reply 'send it' to send"
```

### First Response (Name Collection)

```
Bot: "yo are you coming to active meeting tonight at 7"

User: "yes"

Bot: "Got it! What's your name? (just reply with your first name)"

User: "Saathvik"

Bot: "Thanks Saathvik! Recorded: Yes

View results: https://airtable.com/appecxe8XTHF7yA5a/shraFzSRHX35axIEl"
```

### Smart Response Parsing

```
Bot: "yo are you coming to active meeting tonight at 7"

User: "ya but im running 15 late"

Bot: "Thanks Saathvik! Recorded: Yes (note: running 15 late)

View results: https://airtable.com/..."
```

```
User: "nah can't make it"

Bot: "Thanks Mahi! Recorded: No (note: can't make it)

View results: https://airtable.com/..."
```

## 🛠️ Setup

### 1. Run Database Migration

Go to Supabase → SQL Editor → Paste and run:

```sql
-- From database/sms-poll-schema.sql
-- This adds status, person_name, notes, response_status, and Airtable field tracking
```

Key new fields:
- `sms_poll.status`: 'draft' or 'sent'
- `sms_poll.airtable_question_field`: Dynamic field name for this poll
- `sms_poll_response.person_name`: Collected name
- `sms_poll_response.notes`: Additional context from response
- `sms_poll_response.response_status`: 'pending', 'answered', 'needs_name'

### 2. Airtable Setup

**Required Environment Variables:**
```bash
AIRTABLE_API_KEY=patThE0enpVDHFDbO...
AIRTABLE_BASE_ID=appecxe8XTHF7yA5a
AIRTABLE_TABLE_NAME=Enclave RSVP
AIRTABLE_PUBLIC_RESULTS_URL=https://airtable.com/appecxe8XTHF7yA5a/shraFzSRHX35axIEl
```

**Initial Table Structure:**
- **Person** (Single line text) - Primary field
- **Phone** (Phone number)

Additional fields are created dynamically per poll.

### 3. Redeploy

After updating env vars:
```bash
vercel --prod
# or
git push origin main  # if you have auto-deploy
```

## 🎨 Customization

### Default Poll Options

By default, polls use `["Yes", "No", "Maybe"]`. To customize:

```typescript
// In extractPollDetails
if (!parsed.options || parsed.options.length === 0) {
  parsed.options = ['Yes', 'No', 'Maybe'];  // Change here
}
```

### Poll Question Style

Polls are generated conversationally. The AI:
- Adds "yo" or similar casual prefix
- Keeps it under 160 chars
- Makes it a direct question about attendance

To change the style, edit `generatePollQuestion` in `src/lib/polls.ts`.

## 🐛 Troubleshooting

### Responses Not Recording

1. **Check Airtable table name**: Must match `AIRTABLE_TABLE_NAME` exactly
2. **Check RLS**: All poll operations use `supabaseAdmin` to bypass RLS
3. **Check logs**: Vercel logs will show parse errors

### Name Not Collecting

- Name is stored in `sms_poll_response.person_name`
- Also checked in `app_user.name` as fallback
- If neither exists, agent asks on first response

### Dynamic Fields Not Creating

Airtable auto-creates fields on first insert. The field names are tracked in:
- `sms_poll.airtable_question_field`
- `sms_poll.airtable_response_field`
- `sms_poll.airtable_notes_field`

## 📊 Response Parsing

The AI intelligently extracts responses using `parseResponseWithNotes`:

**Examples:**
- "yes" → `{option: "Yes"}`
- "ya but im running 15 late" → `{option: "Yes", notes: "running 15 late"}`
- "nah can't make it" → `{option: "No", notes: "can't make it"}`
- "maybe, depends on work" → `{option: "Maybe", notes: "depends on work"}`
- "1" → `{option: "Yes"}` (first option)
- "2" → `{option: "No"}` (second option)

The parser:
1. Uses AI to extract option + notes
2. Falls back to keyword matching
3. Supports numeric replies (1, 2, 3)
4. Validates option is in the poll's option list

## 🔮 Future Enhancements

- [ ] Scheduled polls (like scheduled announcements)
- [ ] Multi-question polls
- [ ] Poll results summary via SMS
- [ ] Custom options per poll (not just Yes/No/Maybe)
- [ ] Poll closing/reopening

