# Announcements Feature Guide

## 🎯 What It Does

Allows users to draft, edit, and broadcast SMS announcements via text conversation.

## 🚀 Setup

### 1. Run Database Schema

Go to Supabase → SQL Editor → Paste `database/announcements-schema.sql` and run.

This creates:
- `announcement` table
- `announcement_delivery` table
- Helper functions

### 2. Set Up Scheduler (Optional)

For scheduled announcements, run the worker periodically:

**Option A: Cron Job**
```bash
# Add to crontab (every 5 minutes)
*/5 * * * * cd /path/to/enclave-mvp && npx tsx src/workers/announcement-sender.ts
```

**Option B: Vercel Cron**
Create `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/announcements/send-scheduled",
    "schedule": "*/5 * * * *"
  }]
}
```

Then create API route at `src/app/api/announcements/send-scheduled/route.ts`:
```typescript
import { processScheduledAnnouncements } from '@/workers/announcement-sender';

export async function GET() {
  await processScheduledAnnouncements();
  return Response.json({ success: true });
}
```

## 📱 Usage Examples

### Basic Announcement

```
User: "create an announcement telling actives to come to meeting tonight at 8"

Bot: "okay here's what the announcement will say:

pull up to mahi's apartment for active meeting tonight at 8pm

reply 'send it' to broadcast or reply to edit the message"
```

### Edit Tone

```
User: "be meaner"

Bot: "updated:

pull up to mahi's apartment for active meeting tonight at 8pm or else

reply 'send it' to broadcast"
```

### Send Immediately

```
User: "send it"

Bot: "sent to 47 people 📢"
```

### Schedule for Later

```
User: "create an announcement about study hall tomorrow morning at 9am"

Bot: "okay here's what the announcement will say:

study hall is happening - be there

scheduled for Oct 30, 2025 9:00 AM. reply to edit or 'send now' to send immediately"
```

### Send Now Instead

```
User: "send now"

Bot: "sent to 47 people 📢"
```

### Reference Previous Announcement

```
User: "send the same active meeting announcement as last week"

Bot: "okay here's what the announcement will say:

pull up to mahi's apartment for active meeting tonight at 8pm

reply 'send it' to broadcast"
```

## 🎨 Tone Modifications

Supported tone keywords:
- **be meaner**: adds "or else", more direct
- **be nicer**: friendly, casual
- **be more urgent**: adds "ASAP", "mandatory"
- **be more casual**: relaxed, friendly tone

## 🔒 Permissions

- Anyone can create announcements
- Announcements are sent to ALL opted-in users
- No admin check (for now - add workspace role check if needed)

## 📊 Monitoring

Check announcement status:
```sql
-- See all announcements
SELECT * FROM announcement ORDER BY created_at DESC LIMIT 10;

-- See delivery status
SELECT 
  a.final_content,
  COUNT(*) as total_sent,
  COUNT(CASE WHEN d.status = 'delivered' THEN 1 END) as delivered
FROM announcement a
JOIN announcement_delivery d ON d.announcement_id = a.id
WHERE a.id = 'YOUR_ANNOUNCEMENT_ID'
GROUP BY a.final_content;
```

## 🐛 Troubleshooting

### Announcement not sending

1. Check announcement status:
```sql
SELECT * FROM announcement WHERE id = 'YOUR_ID';
```

2. Check delivery logs:
```sql
SELECT * FROM announcement_delivery WHERE announcement_id = 'YOUR_ID';
```

3. Verify worker is running (for scheduled):
```bash
npx tsx src/workers/announcement-sender.ts
```

### Draft not found

User might not have an active draft. Create one first with "create an announcement..."

## 🎯 Future Enhancements

- [ ] Confirmation step before sending
- [ ] Admin-only announcements
- [ ] Audience targeting (actives only, pledges only)
- [ ] Recurring announcements (weekly meeting reminder)
- [ ] Delivery analytics dashboard
- [ ] Read receipts / delivery confirmations

