# Poke-like Implementation Plan
## Making Enclave Feel Autonomous & Fluid

**Status**: Phase 1 (Knowledge Graph) - In Progress
**Created**: 2025-10-28
**Estimated Timeline**: 4-6 weeks for full implementation

---

## Vision

Transform Enclave from a "search and summarize" tool into an autonomous knowledge assistant that:
- Finds "the line" (exact answer) not "the document"
- Responds with composed answers from structured knowledge
- Proactively helps with deadlines and actions
- Feels conversational and intelligent

---

## Implementation Phases

### ✅ Phase 0: Foundation (COMPLETED)
- [x] Basic SMS functionality
- [x] Hybrid search (FTS + Vector)
- [x] Document chunking strategy
- [x] AI summarization
- [x] Multi-source integration (Docs, Calendar, Slack)

### 🔄 Phase 1: Knowledge Graph Layer (IN PROGRESS)
**Goal**: Turn raw text into structured schemas

**Components**:
- [x] Database schema for events, policies, people, facts
- [x] TypeScript types and helper functions
- [ ] Entity extraction pipeline
- [ ] Nightly consolidator job
- [ ] Linkback/citation system

**Tables Created**:
- `event`: Structured event information
- `event_alias`: Alternative names for flexible matching
- `policy`: Programs and policies
- `person`: People with roles and contact info
- `fact`: Atomic knowledge triples
- `linkback`: Source citations

**Files**:
- `database/knowledge-graph-schema.sql`
- `src/lib/knowledge-graph.ts`

---

### Phase 2: Hierarchical Retrieval
**Goal**: Find exact spans, not whole documents

**Improvements**:
1. **3-Level Chunking**:
   - Section: 2-5k chars (for context)
   - Passage: 800-1200 chars (for search)
   - Sentence: <=280 chars (for extraction)
   - Store offsets for drill-down

2. **Source-Specialized Retrievers**:
   - Google Docs: Index heading_path, boost headings ×1.3
   - Calendar: SQL filter by time first, then re-rank
   - Slack: Thread-aware windows (±10 messages)

3. **BM25 + Vector + Reranker**:
   - Reciprocal Rank Fusion over BM25 and pgvector
   - Cross-encoder reranker (bge-reranker-large) for top 50
   - Store winning span ID for audit

4. **Scoring Formula**:
   ```
   score = 0.6*similarity + 0.2*BM25 + 0.12*time_decay + 0.08*authority
   time_decay = exp(-Δdays/90)
   authority = role_boost + channel_boost
   ```

**Files to Create**:
- `src/lib/hierarchical-chunking.ts`
- `src/lib/reranker.ts`
- `database/hierarchical-chunks-schema.sql`

---

### Phase 3: Entity Extraction Pipeline
**Goal**: Automatically populate knowledge graph

**Components**:
1. **NER (Named Entity Recognition)**:
   - Extract: events, dates, people, locations, orgs
   - Use regex + LLM for high-precision extraction

2. **Event Consolidator**:
   - Nightly job that parses docs/Slack
   - Upserts events with provenance
   - Attaches linkbacks (doc id + line range)

3. **Entity Normalization**:
   - "Big Little" → canonical slug: "big-little"
   - "AD/AG" → "ad-ag-summons"
   - Store aliases in `event_alias` table

4. **Confidence Scoring**:
   - Multiple mentions → higher confidence
   - Recent mentions → higher confidence
   - Official channels → higher confidence

**Files to Create**:
- `src/workers/entity-extractor.ts`
- `src/workers/event-consolidator.ts`
- `src/lib/entity-normalization.ts`

---

### Phase 4: Planner + Tool Executor
**Goal**: Replace "classify & summarize" with autonomous planning

**Architecture**:
```
User Query → Planner → Tool Executor → Composer → Response
```

**Tools**:
1. `search_knowledge({entities, time_window})`: Query knowledge graph
2. `search_docs({query})`: Fallback to RAG
3. `calendar_find({name|time|rrule})`: Query calendar
4. `linkify_sources({fact_ids})`: Get citations
5. `compose_sms({facts, style})`: Format response

**Planner Prompt**:
```
Decide: Is this an event lookup, policy lookup, or open-ended search?
1. Prefer knowledge graph (if confidence > 0.62)
2. Fallback to doc search (if graph fails)
3. Ask clarifier (if both low confidence)
```

**Example Plan** (for "When is AD/AG summons"):
1. Extract entities → {event:'AD/AG Summons'}
2. search_knowledge → event row with date/time
3. linkify_sources → ["AD/AG Playbook §Schedule"]
4. compose_sms → "AD/AG Summons is Thu Nov 6, 7:00 PM @ SAC. Source: AD/AG Playbook §Schedule."

**Files to Create**:
- `src/lib/planner.ts`
- `src/lib/tools.ts`
- `src/lib/composer.ts`

---

### Phase 5: SMS Response Polish
**Goal**: Answers that feel alive

**Style Contract**:
- Line 1: Direct answer
- Line 2: Optional context
- Line 3: Source: tag(s)
- Max 320 chars; split on sentence boundaries if needed

**Clarifiers**:
- Only when `needs_disambiguation = true`
- One 1-liner: "Do you mean AD/AG Summons (pledge) or All-Hands (actives)?"

**Confidence Guardrail**:
- If top fused score < 0.48: "I don't want to guess. Want me to search the docs for the latest mention?"

**Files to Modify**:
- `src/app/api/twilio/sms/route.ts`

---

### Phase 6: Indexing & Model Upgrades
**Goal**: Better embeddings and retrieval

**Improvements**:
1. **Embeddings**:
   - Upgrade to e5-large-v2 or nomic-embed-text
   - Store two vectors per chunk: [title+headings] and [body]
   - Query uses weighted sum

2. **Late Interaction (MaxSim-lite)**:
   - Store token embeddings (averaged in tiles of 16 tokens) for headings
   - Compute MaxSim only on headings to re-rank
   - Cheap and effective for "When is...", "Where is..."

3. **pgvector Tuning**:
   - HNSW, m=32, ef_search=200
   - Separate indexes per source
   - Freshness filters on `updated_at`

**Files to Modify**:
- `src/lib/embeddings.ts`
- `database/vector-indexes.sql`

---

### Phase 7: Data Pipeline Polish
**Goal**: Real-time updates and versioning

**Improvements**:
1. **Doc Watches Everywhere**:
   - Already have GDocs watches
   - Add Slack event subscriptions
   - Debounce & batch embed

2. **Versioning**:
   - `resource_version(resource_id, rev, checksum, created_at)`
   - Citations remain stable even if doc changes

3. **Dedup Smarter**:
   - MinHash over sentences
   - Suppress reposts across channels

**Files to Create**:
- `database/versioning-schema.sql`
- `src/lib/deduplication.ts`

---

### Phase 8: Action Layer (Read-Only)
**Goal**: Suggest actions without executing

**Features**:
1. **Event Actions**:
   - "Add to Calendar?" link → `/actions/add_calendar?id=...`
   - Implement later, just show link for now

2. **Summary Actions**:
   - "Want a 3-bullet summary?" → triggers summarizer

3. **Deadline Detection**:
   - Regex + dateparser for "deadline", "due", "tonight"
   - Store as `alert(source_id, kind, fire_at, text, recipients[])`

**Files to Create**:
- `src/app/api/actions/route.ts`
- `src/lib/deadline-detector.ts`

---

### Phase 9: Proactive Autonomy (Opt-In)
**Goal**: Proactive notifications

**Features**:
1. **Deadline Alerts**:
   - Send SMS n hours before deadline
   - Include source citation

2. **Event Reminders**:
   - "Active meeting in 1 hour @ Mahi's apartment"

3. **Scheduler**:
   - Cron job checks `alert` table
   - Sends SMS via Twilio

**Files to Create**:
- `src/workers/alert-scheduler.ts`
- `database/alerts-schema.sql`

---

### Phase 10: Reliability & Insight
**Goal**: Measure and improve

**Components**:
1. **Eval Harness**:
   - 50-100 gold questions with expected answers
   - Nightly run to track: hit rate, precision@1, abstain rate

2. **Telemetry**:
   - Per-answer: {query, fused_score, retrieval_time_ms, source_ids, plan_steps}
   - Inspect failures quickly

3. **RLS/Audit**:
   - Keep current RLS
   - Add `answer_log` with source refs

**Files to Create**:
- `src/eval/harness.ts`
- `src/lib/telemetry.ts`
- `database/telemetry-schema.sql`

---

## Code Snippets

### Reciprocal Rank Fusion
```typescript
function rrf(ranks: number[], k = 60) {
  return ranks.reduce((s, r) => s + 1 / (k + r), 0);
}

const fused = fuseById(candidatesBM25, candidatesVec, (a, b) => {
  const r1 = rankIn(a.id, candidatesBM25);
  const r2 = rankIn(a.id, candidatesVec);
  return 0.6*similarity[a.id] + rrf([r1, r2]);
});
```

### Time Decay SQL
```sql
SELECT *, 
  (1 - (embedding <=> $1)) AS sim,
  ts_rank_cd(fts, plainto_tsquery($2)) AS bm25,
  exp(-EXTRACT(EPOCH FROM (now() - updated_at))/7776000) AS time_decay
FROM chunk
WHERE space_id = $space
ORDER BY (0.6*sim + 0.2*bm25 + 0.2*time_decay) DESC
LIMIT 50;
```

### Event Extractor
```typescript
for (const chunk of new_chunks) {
  const ents = NER(chunk.text)  // date, time, loc, event_name
  if (ents.has_event && ents.has_datetime) {
    await upsertEvent({
      name: ents.event_name,
      start_at: ents.datetime,
      location: ents.location,
      source_id: chunk.resource_id,
      chunk_id: chunk.id
    })
    await createLinkback({
      entity_type: 'event',
      entity_id: event.id,
      source_id: chunk.resource_id,
      chunk_id: chunk.id
    })
  }
}
```

---

## Success Metrics

### Immediate (Phase 1-3)
- [ ] 90%+ hit rate on event queries ("when is X")
- [ ] Responses cite specific sources
- [ ] Answers are 2-4 sentences (not full docs)

### Medium-term (Phase 4-7)
- [ ] 95%+ hit rate on all query types
- [ ] <500ms response time for knowledge graph queries
- [ ] Proactive deadline alerts working

### Long-term (Phase 8-10)
- [ ] Users say "it feels like Poke"
- [ ] 50+ gold questions passing eval harness
- [ ] <2% false positive rate on extractions

---

## Current Status

**Completed**:
- ✅ Knowledge graph schema
- ✅ TypeScript types and helpers
- ✅ Basic entity extraction helpers

**Next Steps**:
1. Run knowledge graph schema migration
2. Build entity extraction pipeline
3. Create nightly consolidator job
4. Test with SEP data

**Blockers**:
- None currently

---

## Notes

- This is a 4-6 week project for full implementation
- Can be done incrementally (phase by phase)
- Each phase adds value independently
- Priority: Phase 1 (Knowledge Graph) → Phase 4 (Planner) → Phase 2 (Hierarchical Retrieval)

---

**Last Updated**: 2025-10-28

