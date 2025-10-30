🧠 Enclave System Reference (for Product Graph)

This document defines factual, technical, and structural information about Enclave. It is meant for the Enclave query layer to answer any question about what Enclave is, how it works, who built it, and what systems or components it uses. It should not include tone, slang, or stylistic responses — only truth-grounded reference data.

⸻

1. Overview

Product Name: Enclave
Bot/Assistant Name: Jarvis
Type: Multi-modal organizational AI assistant platform
Purpose: To unify an organization's communications and knowledge — across SMS, Slack, Google Calendar, Docs, and other integrations — into a searchable, interactive interface.

Bot Identity: Jarvis is the AI assistant that powers Enclave. When users interact via SMS or other channels, they are speaking with Jarvis, which is built on the Enclave platform. Questions about "Jarvis" or "Enclave" both refer to the same system — Jarvis is the conversational interface, Enclave is the underlying platform.

High-level function: Enclave ingests and links data from different sources (Google, Slack, Airtable, Twilio) into a unified knowledge space. Jarvis (the assistant) enables natural language queries, automated announcements, alerts, and polls through this platform.

Primary goals:
  1. Centralize an organization’s information and communication.
  2. Allow users to query or act on that information directly over text.
  3. Automate repetitive tasks like reminders, polls, and event scheduling.

Target Users: Student organizations, professional fraternities, small teams, and clubs.

⸻

2. Founders and Developers

Primary developer: Saathvik Pai
Core team: The Inquiyr development team
Deployment: Built and hosted under the domain tryenclave.com, typically deployed on Vercel with backend services using Supabase (Postgres) and Airtable.

Development philosophy:
  • Designed as a real-world testbed for AI assistants that integrate live communication with data sources.
  • Prioritizes transparency, speed, and adaptability across orgs.
  • Built as part of the broader Inquiyr ecosystem, which connects communication data (SMS, Slack) to AI understanding and execution.

⸻

3. Technical Architecture

Frontend:
  • Framework: Next.js (App Router) with TypeScript and TailwindCSS.
  • UI Components: Shadcn and custom UI components for events, resources, and opt-in pages.

Backend:
  • Runs in a serverless Node.js environment (Vercel Functions).
  • Routes: /api/** endpoints handle API requests for SMS, search, Google, Slack, and embeddings.
  • Background workers for scheduling, announcements, and data consolidation.

Core Libraries:
  • src/lib/sms.ts: Twilio send/receive and delivery tracking.
  • src/lib/search.ts: Hybrid retrieval (embedding + keyword).
  • src/lib/embeddings.ts: Embedding and reindex logic for stored documents.
  • src/lib/announcements.ts: Handles outbound SMS campaigns.
  • src/lib/answer-composer.ts: Composes AI-based answers using retrieved data.
  • src/lib/telemetry.ts: Logs metrics, events, and query performance.

Data Layer:
  • Supabase/Postgres: stores user, space, message, and telemetry data.
  • Vector embeddings: used for semantic search and content recall.
  • Airtable (optional): for structured event or roster data sync.
  • Google Drive/Docs/Calendar: metadata ingestion and auto-refresh for organizational content.
  • Slack: syncs channels and message metadata for query access.

Integrations:
  • Twilio (SMS send/receive, opt-in/out, delivery events)
  • Google OAuth (Docs, Calendar, Drive)
  • Slack OAuth (channels, messages)
  • OpenAI/Embeddings (for semantic search only, not conversational modeling)

⸻

4. Core Capabilities

a) Knowledge Retrieval:
Allows users to query internal data — documents, events, or messages — via natural language. Uses embedding search combined with metadata filtering.

b) SMS Messaging:
Handles inbound and outbound SMS messages through Twilio. Supports:
  • Conversations and responses.
  • Polls (multiple choice or free response).
  • Bulk announcements.
  • Delivery tracking and error handling.
  • Consent and opt-in/out flow for compliance.

c) Announcements:
Admins can send mass messages to members or segments. Supports scheduling, retry logic, and rate limiting.

d) Polls:
Enables interactive polling via SMS. Collects, validates, and aggregates responses, and can export CSV results.

e) Alerts & Scheduling:
Automated background jobs for deadline or event reminders based on calendar sync or database triggers.

f) Search:
Hybrid RAG system combining embeddings (semantic) and keyword ranking. Supports hierarchical document chunking for context accuracy.

g) Integrations:
Bridges multiple data sources for cross-context retrieval. Example: A question about an event may pull info from both Google Calendar and Slack.

⸻

5. Data Model Summary

Core tables (Postgres):
  • spaces: organizational boundary (multi-tenant isolation)
  • users: members within a space
  • messages: inbound/outbound SMS records
  • polls, poll_responses: interactive voting
  • announcements: scheduled or past campaigns
  • telemetry: event logs and system metrics
  • embeddings: stored semantic vectors for retrieval

⸻

6. AI and Reasoning Stack

Core reasoning pipeline:
  1. Classify intent (search, announce, poll, or enclave_query).
  2. Retrieve evidence (from search, Slack, calendar, or docs).
  3. Compose natural language response using answer-composer.
  4. Route follow-ups using conversation memory (stored in Redis or database).

Model sources:
  • Embedding: OpenAI/Mistral embeddings for similarity search.
  • Reasoning: Local LLM (e.g., GPT-based or Mistral) running with bounded prompt context.
  • No fine-tuning on personal or external data.

Contextual memory:
  • Stores short-term thread memory (previous 3–5 messages).
  • Keeps last intent, named entities, and conversation topic to enable follow-up queries.

⸻

7. Deployment and Operations

Hosting: Vercel (frontend + APIs)
Database: Supabase (Postgres + vector store)
Scheduler: background cron jobs (announcement-sender, alert-scheduler)
Monitoring: telemetry table and optional analytics dashboard (admin/analytics)

Environment variables:
  • SUPABASE_URL, SUPABASE_ANON_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, OPENAI_API_KEY, etc.

Deployment method: continuous integration through GitHub + Vercel deploy hooks.

⸻

8. Compliance & Consent

Twilio SMS Compliance:
  • Opt-in/Opt-out endpoints (/api/sms/optin, /api/sms/optout)
  • Keywords: STOP, START, HELP
  • Consent state enforced in database per user.

Privacy policy: available at tryenclave.com/privacy.
Terms of service: tryenclave.com/terms.

⸻

9. Maintenance & Logging

Telemetry: all incoming queries are logged with timestamp, type, and response metadata.
Failures: stored in messages table with Twilio error codes and webhook payloads.
Admin tools: internal /admin/analytics route for metrics, message delivery stats, and query distribution.

⸻

10. Summary

In simple terms: Enclave is a communication-aware AI platform that merges organizational data into a single intelligent assistant called Jarvis. Jarvis (the conversational interface) and Enclave (the platform) work together to automate communication, enable real-time querying, and ensure compliance with messaging policies — built specifically for internal teams and groups. Questions about "Jarvis" or "Enclave" refer to the same system.

Reference Tag: #enclave_reference_v1


