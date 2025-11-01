# Database Files

SQL files organized by purpose.

## 📁 Folder Structure

### `core/` - Core Schema Files
Essential schema files for setting up a new database:

**Foundation**:
- `supabase-setup.sql` - Main setup script (START HERE)
- `schema.sql` - Core schema
- `supabase-pgvector.sql` - Vector search setup

**Search**:
- `supabase-chunks.sql` - Document chunking
- `supabase-chunk-vector-function.sql` - Chunk vector function
- `supabase-vector-function.sql` - Vector search function
- `supabase-search-function.sql` - Search function
- `search-function.sql` - Additional search functions

**Integrations**:
- `google-docs-schema.sql` - Google Docs tables
- `google-docs-functions.sql` - Google Docs functions
- `google-calendar-schema.sql` - Calendar tables
- `slack-schema.sql` - Slack tables

**SMS Bot**:
- `sms-optin-schema.sql` - Opt-in table
- `sms-query-session-schema.sql` - Query sessions
- `sms-conversation-history-schema.sql` - Message history
- `sms-poll-schema.sql` - Poll tables
- `sms-session-frame.sql` - Session frames

**Other**:
- `telemetry-schema.sql` - Analytics/telemetry
- `announcements-schema.sql` - SMS announcements
- `alerts-schema.sql` - Alert system
- `knowledge-graph-schema.sql` - Knowledge graph
- `hierarchical-chunks-schema.sql` - Chunking

**Verification**:
- `verify-workspace-setup.sql` - Verify setup

### `migrations/` - Database Migrations
Historical migrations for specific changes:
- `add-*.sql` - Adding columns/features
- `make-*.sql` - Altering tables
- `migrate-*.sql` - Data migrations
- `update-*.sql` - Updates

### `fixes/` - Bug Fixes
One-off fix scripts from development:
- `fix-*.sql` - Fix scripts
- `cleanup-*.sql` - Cleanup scripts
- `disable-*.sql` - Temporary disables

### `obsolete/` - Old/Test Files
Old test files and development artifacts:
- `check-*.sql` - Diagnostic queries
- `test-*.sql` - Test queries
- `debug-*.sql` - Debug scripts
- `demo-data.sql` - Sample data
- `sample-*.sql` - Examples

---

## 🚀 Quick Setup

For a new database:

```bash
# 1. Core setup
supabase-setup.sql
supabase-pgvector.sql

# 2. Integrations (as needed)
google-docs-schema.sql
slack-schema.sql
sms-optin-schema.sql

# 3. Verify
verify-workspace-setup.sql
```

See [docs/DATABASE_SETUP.md](../docs/DATABASE_SETUP.md) for detailed instructions.

---

## 📝 Notes

- **Always backup** before running SQL scripts
- Run scripts in Supabase SQL Editor or via psql
- Check for dependencies between files
- Core files are tested and stable
- Fixes/obsolete are for reference only

