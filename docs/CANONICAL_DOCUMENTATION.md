## Enclave MVP — Canonical Documentation

This is the single source of truth for how Enclave MVP works across backend, frontend, data, integrations, background jobs, and deployment. All other docs are historical or supplementary; if they differ from this, this document wins.

### High-level Overview
- **Purpose**: Aggregate an organization’s knowledge and communications (Docs, Calendar, Slack, SMS) and enable search, alerts, and announcements.
- **Platform**: Next.js App Router, TypeScript, Tailwind UI components.
- **Data**: Postgres (via Supabase), vector embeddings, Airtable (optional), Slack metadata, Google Docs/Calendar metadata, SMS events.
- **Integrations**: Google (Docs, Drive, Calendar), Slack, Twilio SMS, Airtable, OpenAI/Embeddings.
- **Background Jobs**: Alert scheduling, announcements, knowledge consolidation.

### Architecture
- **Frontend**: Next.js pages under `src/app/**/page.tsx`; UI components under `src/components/*`.
- **APIs**: Route handlers under `src/app/api/**/route.ts` (App Router). All requests are authenticated/authorized via middleware and per-route logic.
- **Lib Layer**: Core modules in `src/lib/*` for integrations, search, embeddings, telemetry, caching, and security.
- **Workers**: Long-running/cron tasks in `src/workers/*`.
- **Database**: SQL migrations and scripts in `database/`; generated types in `src/lib/database.types.ts`.

### Environment & Configuration
Configure required keys in `.env` based on `env.example`. Centralized access via `src/lib/env.ts`.
- Supabase/Postgres: Database storage, RLS, and auth-related data.
- Slack: OAuth (start/callback), channel sync, and polling.
- Google: OAuth (start/callback), Docs, Drive webhook, Calendar sync.
- Twilio: Inbound SMS webhook, outbound SMS send and delivery status webhooks.
- OpenAI/Embeddings provider: Embedding and reindex endpoints.

### Data Model (Conceptual)
- Users/Spaces: Multi-tenant boundary using `spaces` and membership endpoints.
- Content: Google Docs metadata, Slack messages metadata, URLs/uploads, embeddings.
- Conversations: SMS messages with direction, status, error codes, provider SIDs; optional delivery events.
- Telemetry: Query logs, analytics for usage and quality signals.

### API Endpoints
All endpoints live under `src/app/api/**/route.ts`. Key groups and responsibilities:

- Auth + OAuth
  - `oauth/google/start`, `oauth/google/callback`: Google OAuth install flow.
  - `oauth/slack/start`, `oauth/slack/callback`: Slack OAuth install flow.
  - `test/oauth`: OAuth diagnostics.

- Google Integrations
  - Docs: `google/docs/list`, `google/docs/add`, `google/docs/refresh` for listing, attaching, refreshing doc metadata.
  - Calendar: `google/calendar/list`, `google/calendar/sources`, `google/calendar/sync`, `google/calendar/refresh`, `google/calendar/auto-sync` for calendar data ingest/sync.
  - Drive Webhooks: `webhooks/google/drive` for change notifications and downstream refresh.

- Slack Integrations
  - `slack/channels`: List channels.
  - `slack/sync`: Sync Slack data/config to the system.
  - `slack/disconnect`: Remove Slack connection.
  - `slack/poll`: Poll for updates when events API is insufficient.

- Search & Knowledge
  - `search`, `search/hybrid`, `search/google-docs`: Query across embeddings and sources.
  - `ingest/url`: Add external content by URL for crawling/indexing.
  - `upload`: Upload local files for indexing.
  - `embeddings/reindex`, `embeddings/reindex-chunks`: Rebuild embeddings for content or individual chunks.
  - `knowledge/consolidate`, `internal/consolidate`: Consolidation routines to merge, dedupe, or update knowledge graph and indexes.
  - `ai`: Model-backed utilities (e.g., answer composition via `src/lib/answer-composer.ts`).

- SMS
  - `twilio/sms`: Inbound webhook from Twilio; records inbound messages and triggers processing.
  - `sms/blast`: Send bulk messages to a segment or list.
  - `sms/optin`, `sms/optout`: Manage consent state.
  - Status tracking via message rows (delivered/failed with error codes), and optional events.

- Spaces & Resources
  - `spaces`, `spaces/[id]/members`, `spaces/[id]/invite`: Space management and membership.
  - `resources`, `resources/[id]`: Generic resource registry used by UI.

- Telemetry & Admin
  - `query-log`: Append or view query interactions for analytics.
  - `admin/analytics`: Aggregate operational/usage metrics.
  - `report`: Centralized reporting (errors, outcomes, counters) from client or jobs.
  - `telemetry`: Health checks, pings, or diagnostic traces.

- Testing & Utilities
  - `test/database`, `test/google-docs`: Integration checks.
  - `eval`: Hooks for evaluation harness flows.
  - `ask`: Direct question-answer interface entry point.
  - `resources`, `upload`, `ingest/url`: Developer utilities for manual ingestion.

### Frontend Pages
Located under `src/app/**/page.tsx`:
- `page.tsx` (root), `home/page.tsx`: Landing and main user entry.
- `privacy/page.tsx`, `terms/page.tsx`: Policy pages.
- `resources/page.tsx`: UI for resources listing/management.
- `sms-optin/page.tsx`: Public consent flow.
- `sign-in/[[...sign-in]]/page.tsx`, `sign-in/clerk/page.tsx`, `sign-up/[[...sign-up]]/page.tsx`: Auth UIs.

Key components under `src/components/*` include dialogs for uploads, calendar linking, Slack settings, reporting, dropdowns, and generic UI primitives (`ui/*`).

### Library Modules (Core Behaviors)
- `env.ts`: Centralized environment variable access and validation.
- `supabase.ts`: Database client and helpers.
- `security.ts`: RLS alignment, authZ helpers, and request validation.
- `embeddings.ts`: Embedding provider access, chunk encoding, reindex APIs.
- `search.ts`, `specialized-retrievers.ts`, `reranker.ts`: Retrieval augmented search and ranking.
- `hierarchical-chunker.ts`: Splitting documents into hierarchical chunks for better retrieval.
- `knowledge-graph.ts`, `entity-extractor.ts`: Entity/relationship extraction and graph ops.
- `google-docs.ts`, `google-calendar.ts`: Google API calls, sync orchestration, webhooks handling helpers.
- `slack.ts`: Slack API calls, channel and message sync utilities.
- `sms.ts`: Twilio send/receive, templating, status mapping, and error code normalization.
- `airtable.ts`: Airtable ingestion or config sync (optional integration).
- `announcements.ts`, `polls.ts`: Outbound comms and polling flows.
- `answer-composer.ts`, `planner.ts`, `deadline-detector.ts`: AI composition, task planning, and deadline detection.
- `telemetry.ts`, `utils.ts`, `cache.ts`: Logging, helpers, and caching.
- `eval-harness.ts`: Evaluation utilities for quality measurement.
- `database.types.ts`: Generated DB types for compile-time safety.

### Background Workers
Located in `src/workers/*`:
- `alert-scheduler.ts`: Periodically evaluates upcoming deadlines and conditions to enqueue alerts.
- `announcement-sender.ts`: Sends scheduled or ad‑hoc announcements (via SMS/Slack).
- `event-consolidator.ts`: Consolidates content updates from Google/Slack/uploads into indexes and knowledge graph.

### SMS Capabilities
This section explains all SMS functionality end‑to‑end: announcements (broadcasts), interactive polls, Q&A/query via SMS, consent (opt‑in/opt‑out), delivery tracking, segmentation, rate limiting, configuration, and testing.

#### Data Model
- Messages: Each row includes `user_id` (or phone), `direction` (inbound|outbound), `body`, `status` (queued|sent|delivered|failed), `error_code`, `provider_sid`, `created_at`, and optional `metadata` (JSONB with raw webhook payloads).
- Consent: User’s `consent_status` controls whether outbound SMS can be sent.
- Delivery Events (optional): Normalized timeline of provider events for granular debugging.

#### Consent (Opt‑In / Opt‑Out)
- Endpoints: `api/sms/optin`, `api/sms/optout`.
- Flow: Public `sms-optin` page → user submits phone and consent → consent flag stored → future sends allowed. Opt‑out sets consent to false and stops messages.
- Best practice: Return clear copy and log consent timestamp and source.

#### Inbound Processing
- Twilio → `api/twilio/sms` webhook (signed). We parse, validate, store inbound message, then route to handlers:
  - Keyword handling (e.g., STOP/START/HELP) → consent updates or auto‑replies.
  - Poll handler (if a poll is active for the user/segment).
  - Q&A handler: forward to AI/knowledge retriever and compose an answer if enabled.
- Errors are recorded with `error_code` and raw payload in `metadata`.

#### Outbound Sending
- Programmatic sends via `src/lib/sms.ts` or API endpoints (e.g., `api/sms/blast`).
- Status lifecycle: queued → sent → delivered|failed; updates reflected via Twilio callbacks if configured.
- Templating: Prefer simple, parameterized templates for consistency and compliance.

#### Announcements (Broadcasts)
- Purpose: Send one‑off or scheduled messages to a list/segment.
- Libraries: `src/lib/announcements.ts` handles targeting, batching, and send orchestration.
- Endpoint: `api/sms/blast` to initiate a campaign; worker `src/workers/announcement-sender.ts` for scheduled batches.
- Segmentation inputs:
  - Static lists (explicit user/phone arrays)
  - Dynamic filters (e.g., tags, space membership, consent = true)
- Delivery & retries:
  - Batch send with backoff on provider/throttling errors.
  - Persist per‑recipient status; expose failures for retry.
- Reporting:
  - Success/failure counts, error code histograms, click‑through (if links), and reply rate.

#### Interactive Polls
- Purpose: Ask a multiple‑choice or free‑response question over SMS and collect structured answers.
- Library: `src/lib/polls.ts` manages poll creation, options, state, and response parsing.
- Flow:
  1) Create a poll with prompt, options (optional for MCQ), and target segment.
  2) Broadcast initial question to segment.
  3) Inbound replies are matched to the active poll (by user/segment/campaign) and normalized.
  4) Store results; optionally send confirmation or follow‑ups.
- Validation:
  - Accept synonyms or numeric indices for options (e.g., "1", "A", or option text).
  - On invalid input, send help text with valid options.
- Analysis:
  - Tally responses by option; export CSV; segment by metadata (space, cohort, time).

#### Q&A / Query via SMS
- Purpose: Let users ask free‑form questions and get answers from the knowledge base.
- Entry: Inbound messages not matched to system keywords or polls are routed to the Q&A handler.
- Retrieval: Uses search/embeddings (`src/lib/search.ts`, `src/lib/answer-composer.ts`).
- Safety:
  - Rate limit by user/phone.
  - Respect consent; do not respond if opted out.
  - Redact or withhold sensitive content per `src/lib/security.ts`.

#### Segmentation & Targeting
- Common selectors: space membership, tags, consent = true, last engagement date, poll responses.
- Indexing: Ensure DB indexes on `(phone, created_at desc)` and `(user_id, created_at desc)`; add indexes to segment join keys.

#### Rate Limiting & Compliance
- Apply per‑recipient minimum spacing and per‑campaign TPS caps to satisfy carrier trust.
- Honor keywords: STOP/UNSTOP/START/HELP.
- Include required business identification and opt‑out instructions in broadcast templates.

#### Delivery Tracking & Troubleshooting
- Store provider SID and `error_code` for each message. Enrich with provider docs link in UI.
- Keep raw webhook payloads in `metadata` for forensics.
- Recommended admin UI features:
  - Conversations list with last message/time, consent, failed count.
  - Thread view with statuses, error codes, resend/export, and tags.

#### API Surfaces (SMS‑related)
- Webhooks: `POST /api/twilio/sms`
- Consent: `POST /api/sms/optin`, `POST /api/sms/optout`
- Broadcasts: `POST /api/sms/blast`
- Admin: use `report`, `admin/analytics`, and `query-log` for outcomes and telemetry

#### Libraries
- `src/lib/sms.ts`: Twilio integration, status mapping, send helpers.
- `src/lib/announcements.ts`: Campaign orchestration (batching, scheduling, retries).
- `src/lib/polls.ts`: Poll lifecycle and response normalization.

#### Background Jobs
- `src/workers/announcement-sender.ts`: Processes scheduled or queued announcements.
- `src/workers/alert-scheduler.ts`: Can schedule SMS alerts when deadlines or rules trigger.

#### Configuration
- Environment: Twilio Account SID/Auth Token, Messaging Service SID. Set in `.env` and consumed via `src/lib/env.ts`.
- Webhooks: Point Twilio inbound webhook to `/api/twilio/sms` (POST). Secure with signature validation.
- Opt‑in page: `src/app/sms-optin/page.tsx` for public consent flow.

#### Testing & QA
- Use `scripts/test-airtable.js`, `scripts/test-metadata-api.js`, and E2E tests for broader system health; add SMS‑specific test vectors as needed.
- Manual: Send test inbound messages to trigger keyword handling, polls, and Q&A; verify statuses and error codes.

### SMS Conversation Model
- Each message row stores: `user_id` (or phone), `direction` (inbound/outbound), `body`, `status` (queued|sent|delivered|failed), `error_code`, `provider_sid`, `created_at`, and optional `metadata` (JSONB for raw webhook payloads).
- Inbound: Twilio posts to `api/twilio/sms` → parsed + stored → optional responders (AI, rules) → reply created as outbound.
- Outbound: Created by `sms.ts` helpers or `sms/blast` → sent to Twilio → status updates processed via webhook/events (if enabled) and stored back.
- Consent: `sms/optin` and `sms/optout` set consent flags and gate sending.
- Troubleshooting: Filter by `status = failed`, use `error_code`, `provider_sid`, and `metadata` for root causes.

### Search & Retrieval Flow
1) Content enters via Google Docs, Slack, URLs, or Uploads.
2) Chunking and embeddings are created (`hierarchical-chunker`, `embeddings`).
3) Search queries hit `api/search` or `api/search/hybrid`, pulling top‑k chunks with optional re-ranking.
4) Answer composition uses `answer-composer` and related utilities to produce coherent results.
5) Reindex endpoints refresh embeddings after content changes.

### Security & Authorization
- Authentication via Next.js middleware and providers (Clerk or Supabase session).
- RLS aligned: queries always scoped to a `space` and `user` where applicable.
- `security.ts` enforces input validation, rate limits, and capability checks as needed.

### Telemetry & Analytics
- `query-log` records searches/asks for analytics.
- `admin/analytics` aggregates usage: queries, errors, sync health, announcement outcomes.
- `telemetry` endpoint is available for pings/health or structured logs.

### Deployment & Environment
- Next.js app deployable to Vercel or similar Node platform.
- Environment variables managed via `.env` and `src/lib/env.ts` validation.
- Long-running workers are triggered via scheduled jobs (cron) or external schedulers.

### Testing
- E2E tests under `tests/e2e/*` with Playwright config in `playwright.config.ts` and scripts under `scripts/`.
- Smoke tests and helper scripts (`scripts/run-tests.sh`, `test-*.js`) exercise integrations.

### Operational Playbooks (Condensed)
- Reindex embeddings: call `api/embeddings/reindex(-chunks)` or run worker to rebuild after large ingests.
- Fix Google sync issues: re-run OAuth, call `google/docs/refresh` or `google/calendar/refresh`; check Drive webhook deliveries.
- Fix Slack sync: re‑auth via `oauth/slack/start`, then `slack/sync`; verify scope and channel access.
- SMS failures: inspect message `status`, `error_code`, and Twilio logs; ensure consent; retry via announcement tools.

### Admin Views (Recommended)
For SMS troubleshooting and continuous improvement, implement an internal page:
- Conversations list (one row per person) with last message/time, consent, failed count.
- Conversation detail with full thread, statuses, error codes, resend/export controls, tags.
- Filter by time, failure, campaign, or tags; export a single thread for sharing.

### Maintenance Guidelines
- Treat this file as canonical; update when APIs or flows change.
- Keep lib modules single‑purpose and high‑signal.
- Prefer adding indexes when new access patterns emerge (e.g., `(phone, created_at desc)`).
- Ensure RLS and auth paths are updated if data shapes change.

### Quick Index of Implementations
- API routes: `src/app/api/**/route.ts` (see list above)
- Workers: `src/workers/*`
- Libs: `src/lib/*`
- Pages: `src/app/**/page.tsx`
- Components: `src/components/*`
- DB SQL: `database/*`

If you need deeper per-function documentation (parameters, return types, and example payloads), say "Generate API Reference" and I will produce a full endpoint-by-endpoint reference from the source.


