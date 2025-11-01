# Database Setup Guide

Complete guide to setting up the Enclave database in Supabase.

## 📋 Overview

Enclave uses PostgreSQL (via Supabase) with pgvector for semantic search. The database is organized into multiple schemas for different features.

---

## 🚀 Quick Setup

### 1. Prerequisites

- Supabase account and project
- Database access (SQL Editor)

### 2. Run Core Setup

In Supabase SQL Editor, run these files **in order**:

```bash
# 1. Foundation
database/core/supabase-setup.sql        # Core tables
database/core/supabase-pgvector.sql      # Vector search extension

# 2. Vector Search
database/core/supabase-chunks.sql               # Chunking tables
database/core/supabase-chunk-vector-function.sql # Vector functions
database/core/supabase-vector-function.sql      # Vector search
database/core/supabase-search-function.sql      # Search functions

# 3. Verification
database/core/verify-workspace-setup.sql
```

---

## 🔌 Integration Setup

### Google Docs
```bash
database/core/google-docs-schema.sql
database/core/google-docs-functions.sql
```

### Google Calendar
```bash
database/core/google-calendar-schema.sql
```

### Slack
```bash
database/core/slack-schema.sql
```

### SMS Bot
```bash
database/core/sms-optin-schema.sql
database/core/sms-query-session-schema.sql
database/core/sms-conversation-history-schema.sql
database/core/sms-poll-schema.sql
database/core/announcements-schema.sql
```

### Other Features
```bash
database/core/telemetry-schema.sql
database/core/alerts-schema.sql
database/core/knowledge-graph-schema.sql
database/core/hierarchical-chunks-schema.sql
```

---

## 📁 Database Structure

### Core Tables
- `space` - Workspaces (multi-tenant boundaries)
- `app_user` - User accounts
- `resource` - Documents, files, content
- `event_meta` - Calendar events
- `tag` - Content tags
- `resource_tag` - Tag mappings
- `query_log` - Search query logs
- `gap_alert` - Alert system

### Search & Vectors
- `chunk` - Document chunks for vector search
- Embeddings stored in `pgvector` extension

### Integrations
- **Google**: `google_doc`, `google_doc_chunk`
- **Slack**: `slack_channel`, `slack_message`
- **Calendar**: `calendar_event`

### SMS
- `sms_optin` - Opt-in status
- `sms_announcement_drafts` - Announcement drafts
- `sms_poll_drafts` - Poll drafts
- `sms_announcements` - Sent announcements
- `sms_poll` - Sent polls
- `sms_poll_response` - Poll responses
- `sms_conversation_history` - Message history
- `sms_query_session` - Query sessions

---

## 🔐 Security

### Row Level Security (RLS)

RLS policies are configured for:
- Multi-tenant workspace isolation
- User-based access control
- Resource visibility rules

### Default Space

All resources are stored in the default space:
- **Space ID**: `00000000-0000-0000-0000-000000000000`
- **Visibility**: All users can view

---

## 🧪 Testing

After setup, verify:

```sql
-- Check tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';

-- Check vector search
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Check default space
SELECT * FROM space WHERE id = '00000000-0000-0000-0000-000000000000';
```

---

## 📝 Environment Variables

After setup, configure:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## 🔧 Maintenance

### Migrations

Historical migrations are in `database/migrations/`:
- Add new features
- Alter schemas
- Data migrations

### Fixes

One-off fixes are in `database/fixes/`:
- Bug fixes
- RLS adjustments
- Temporary workarounds

⚠️ **Only use these if directed or debugging**

---

## ❓ Troubleshooting

### Permission Errors

- Use Supabase SQL Editor (not direct connection)
- SQL Editor has admin permissions

### Tables Already Exist

- Setup scripts use `CREATE TABLE IF NOT EXISTS`
- Safe to run multiple times
- Data is preserved

### Vector Search Not Working

- Verify pgvector extension is installed
- Check chunk table has embeddings
- Run reindex: `/api/embeddings/reindex-chunks`

### Missing Data

- Check default space exists
- Verify user accounts
- Test search functions

---

## 📚 Additional Resources

- [Supabase Docs](https://supabase.com/docs)
- [pgvector Docs](https://github.com/pgvector/pgvector)
- [Visibility Model](./VISIBILITY_MODEL.md)
- [Canonical Documentation](./CANONICAL_DOCUMENTATION.md)
