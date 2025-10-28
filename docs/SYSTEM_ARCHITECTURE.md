# Enclave System Architecture
## Complete Workflow: Storage, Querying, and Presentation

### Overview
Enclave is a multi-source knowledge management platform that combines:
- **Document Storage**: PDFs, text files, Google Docs, Calendar events, Slack messages
- **Hybrid Search**: Full-text search (keyword) + vector search (semantic)
- **Multi-channel Access**: Web interface + SMS querying

---

## 1. STORAGE WORKFLOW

### A. Document Upload (`/api/upload`)

**File Types Supported:**
- PDFs (.pdf)
- Text files (.txt)
- Images (OCR planned but currently disabled)

**Process:**
1. **File Processing** (`src/app/api/upload/route.ts`):
   - Extract text from PDF using `extractTextFromPdf`
   - Extract text from text files
   - OCR for images (currently disabled)

2. **Database Insert**:
   ```sql
   INSERT INTO resource (
     space_id, title, body, type, url,
     source, visibility, created_by
   )
   VALUES (...)
   ```

3. **Embedding Generation** (Async, best-effort):
   - **Text for embedding**: `[title]\n\n[extracted_text]`
   - **API Call**: Mistral AI `/v1/embeddings` endpoint
     - Model: `mistral-embed` (1024 dimensions)
     - Input: Text up to 200,000 chars
   - **Storage**: `resource_embedding` table
     ```sql
     INSERT INTO resource_embedding (resource_id, embedding)
     VALUES (?, ?) -- 1024-dim float array
     ```

4. **Chunking** (for long documents):
   - Split text into ~1500 character chunks
   - Generate embeddings for each chunk
   - Store in `resource_chunk` table
   - Used for more granular search in long documents

---

### B. Google Docs Integration (`/api/google/docs/add`)

**Process:**
1. **Authentication**: OAuth token from Google
2. **Metadata Fetch**: Get file info from Google Drive API
3. **Content Extraction**:
   - Fetch document structure from Google Docs API
   - Flatten document blocks (paragraphs, headings, lists)
   - Extract heading hierarchy for context
4. **Chunking**:
   - Split into semantic chunks (~1500 chars)
   - Preserve heading path for each chunk
5. **Storage**:
   ```sql
   -- Source metadata
   INSERT INTO google_doc_source (
     space_id, google_file_id, title, mime_type,
     latest_revision_id, added_by
   )
   
   -- Chunks with embeddings
   INSERT INTO google_doc_chunks (
     space_id, source_id, heading_path, text,
     chunk_index, embedding
   )
   ```
6. **Real-time Sync**: Create Google Drive watch for file updates

---

### C. Calendar Integration (`/api/oauth/google/callback`)

**Process:**
1. **OAuth Flow**: User grants Google Calendar access
2. **Event Fetch**: Get events from Calendar API
   - Filter by time range (last 3 months, next 6 months)
   - Include: summary, description, location, attendees
3. **Format for search**:
   ```
   Event: [summary]
   Calendar: [email]
   Attendees: [attendees]
   Start: [formatted_date]
   End: [formatted_date]
   Description: [description]
   Location: [location]
   ```
4. **Generate Embeddings**: For each event
5. **Storage**:
   ```sql
   INSERT INTO calendar_event (
     space_id, source_id, summary, description,
     start_time, end_time, location, added_by
   )
   
   INSERT INTO calendar_event_embedding (
     event_id, embedding
   )
   ```

---

### D. Slack Integration (`/api/slack/sync`)

**Process:**
1. **OAuth**: User connects Slack workspace
2. **Channel Sync**: Fetch messages from connected channels
3. **Message Processing**:
   - Include thread context when available
   - Format: `Channel: #channel-name\nMessage: [text]`
4. **Generate Embeddings**: For each message
5. **Storage**:
   ```sql
   INSERT INTO slack_message (
     space_id, channel_name, text, thread_context,
     slack_message_id, added_by
   )
   
   INSERT INTO slack_message_embedding (
     message_id, embedding
   )
   ```

---

## 2. QUERY WORKFLOW

### A. Hybrid Search Function (`src/lib/search.ts`)

**Search Types:**
1. **Full-Text Search (FTS)**: Keyword matching via PostgreSQL
2. **Vector Search**: Semantic similarity via cosine distance
3. **Hybrid**: Combines both methods

**Process:**

#### Step 1: Generate Query Embedding
```typescript
const queryEmbedding = await embedText(query)
// 1024-dim vector from Mistral AI
```

#### Step 2: Search All Sources in Parallel

**2a. Regular Resources (FTS)**
- **RPC**: `search_resources_fts(query, space_id, limit, user_id)`
- **Method**: PostgreSQL full-text search with `ts_rank`
- **Returns**: Resources with `rank` score (0-1)
- **Boosting**: Multiply by 10 + 0.3 base = scores 0.3-1.0

**2b. Regular Resources (Vector)**
- **RPC**: `search_resources_vector(query_embedding, space_id, limit, user_id)`
- **Method**: Cosine similarity `1 - (a <-> b)`
- **Returns**: Resources with `similarity` score (0-1)
- **Filter**: Personal workspace filters by `created_by`

**2c. Google Docs (Vector)**
- **RPC**: `search_google_docs_vector(query_embedding, space_id, limit, user_id)`
- **Method**: Search in `google_doc_chunks` table
- **Returns**: Chunks with similarity scores
- **Context**: Includes heading_path for location

**2d. Calendar Events (Vector)**
- **RPC**: `search_calendar_events_vector(query_embedding, space_id, limit, user_id)`
- **Method**: Search in `calendar_event_embedding` table
- **Returns**: Events with similarity scores
- **Format**: Includes date/time/location

**2e. Slack Messages (Vector)**
- **Function**: `searchSlackMessages(query_embedding, space_id, limit)`
- **Method**: Search in `slack_message_embedding` table
- **Returns**: Messages with similarity scores
- **Context**: Includes channel and thread info

#### Step 3: Combine and Rank
```typescript
const allResults = [
  ...regularFTSResults,
  ...regularVectorResults,
  ...googleDocsResults,
  ...calendarResults,
  ...slackResults
]

// Sort by score/rank
allResults.sort((a, b) => (b.score || 0) - (a.score || 0))
```

#### Step 4: Return Top Results
- Limit: 20 results by default
- Deduplication: Remove duplicates by resource ID
- Scored by relevance (higher = better match)

---

### B. SMS Search Workflow (`/api/twilio/sms`)

**Unique Features:**
- Chunking strategy for long documents
- Query classification (content/enclave/chat)
- Message splitting at sentence boundaries

**Process:**

1. **Receive SMS**: Twilio webhook validates signature
2. **User Authentication**:
   - Check `sms_optin` table (consent)
   - Check `sms_query_session` (active session)
3. **Query Processing**:
   ```typescript
   // Find SEP workspaces
   const sepWorkspaces = await supabase
     .from('space')
     .select('*')
     .ilike('name', '%SEP%')
   
   // Hybrid search across all SEP workspaces
   const results = await searchResourcesHybrid(
     query, spaceIds, filters, options, userId
   )
   ```
4. **Deduplication**: Remove duplicate results
5. **AI Summarization** (for long content):
   - **Chunking Strategy**: Split documents into 1500-char chunks with 200-char overlap
   - **Sequential Search**: Try each chunk until AI finds answer
   - **Detection**: Skip "no information" responses, continue to next chunk
   - **API**: Call `/api/ai` with `type='summary'`
   - **Prompt**: Extract ALL relevant info in 2-4 sentences
6. **Query Classification**: 
   - Use LLM to classify: 'content' | 'enclave' | 'chat'
   - Fallback based on hasGoodResults check
7. **Response Formatting**:
   - Add welcome message (only for new users)
   - Add AI summary or raw content
   - Split long messages at sentence boundaries
8. **Send SMS**: Return TwiML XML response

---

## 3. PRESENTATION WORKFLOW

### A. Web Interface

**Pages:**
- **`/`**: Landing page
- **`/resources`**: Resource list + search interface
- **`/sign-in`**: Clerk authentication

**Resource Display** (`src/app/resources/page.tsx`):
```typescript
// Fetch resources
const { data: resources } = await supabase
  .from('resource')
  .select('*, tags:resource_tag(tag(*)), event_meta(*)')
  .eq('space_id', spaceId)

// Display as cards with:
// - Title
// - Body preview (truncated)
// - Tags
// - Source badge (upload/gdoc/calendar/slack)
// - Actions (view, edit, delete)
```

**Search Interface**:
- **Input**: Query text
- **API Call**: `GET /api/search/hybrid?q=[query]&workspace=[id]`
- **Results**: Array of SearchResult objects
  ```typescript
  interface SearchResult {
    id: string
    title: string
    body: string
    type: 'doc' | 'event' | 'google_doc' | 'slack'
    source: 'upload' | 'gdoc' | 'gcal' | 'slack'
    score: number
    rank: number
    tags: Tag[]
    metadata: any
  }
  ```
- **Display**: Cards sorted by score with highlights

### B. SMS Interface

**Message Flow**:
1. **User texts**: "when is active meeting"
2. **Search**: Across SEP workspaces
3. **AI Processing**: 
   - Chunk document → find relevant section
   - Generate summary: "Active meetings are every Wednesday at 8:00 PM, usually at Mahi's apartment (461B Kelton) or Ash's apartment (610 Levering). Attendance is mandatory."
4. **Response**: Send SMS with answer
5. **If too long**: Split into multiple messages at sentence boundaries

---

## 4. DATABASE SCHEMA

### Core Tables

**`resource`**: Main document storage
```sql
CREATE TABLE resource (
  id UUID PRIMARY KEY,
  space_id UUID NOT NULL,
  title TEXT,
  body TEXT,
  type TEXT,
  url TEXT,
  source TEXT, -- 'upload', 'gdoc', 'gcal', 'slack'
  visibility TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

**`resource_embedding`**: Vector embeddings for semantic search
```sql
CREATE TABLE resource_embedding (
  resource_id UUID PRIMARY KEY,
  embedding vector(1024), -- pgvector
  updated_at TIMESTAMPTZ
)
```

**`google_doc_source`**: Google Docs metadata
```sql
CREATE TABLE google_doc_source (
  id UUID PRIMARY KEY,
  space_id UUID,
  google_file_id TEXT,
  title TEXT,
  latest_revision_id TEXT,
  added_by TEXT
)
```

**`google_doc_chunks`**: Chunked Google Docs with embeddings
```sql
CREATE TABLE google_doc_chunks (
  id UUID PRIMARY KEY,
  space_id UUID,
  source_id UUID,
  heading_path TEXT,
  text TEXT,
  chunk_index INT,
  embedding vector(1024),
  added_by TEXT
)
```

### Search Functions

**`search_resources_fts`**: Keyword search via PostgreSQL FTS
- Uses `ts_rank` for ranking
- Filters by space_id and user_id

**`search_resources_vector`**: Semantic search via pgvector
- Cosine similarity: `1 - (embedding <=> query_embedding)`
- Filters by space_id and user_id

**`search_google_docs_vector`**: Search Google Docs chunks
- Same cosine similarity approach
- Returns chunks with heading context

**`search_calendar_events_vector`**: Search calendar events
- Embedding-based similarity
- Filters by time range

**`search_slack_messages`**: Search Slack messages
- Embedding-based similarity
- Includes channel and thread context

---

## 5. SECURITY & PRIVACY

### Row Level Security (RLS)
- **Personal Workspace**: Users can only see their own resources
- **Shared Workspaces**: All members can search all resources
- **Implementation**: Filters applied at query level with `created_by` check

### Authentication
- **Web**: Clerk authentication (OAuth)
- **SMS**: Phone number + opt-in validation
- **API**: JWT tokens for authenticated requests

### Data Access
- **Default Space**: `00000000-0000-0000-0000-000000000000` (personal)
- **Custom Spaces**: Invite-only, managed via `space_member` table
- **Google/Slack**: User-specific tokens stored securely

---

## 6. AI INTEGRATION

### Mistral AI Usage

1. **Embeddings** (`/v1/embeddings`):
   - Model: `mistral-embed`
   - Dimensions: 1024
   - Use case: Semantic search

2. **Summarization** (`/api/ai` with `type='summary'`):
   - Model: `mistral-small-latest`
   - Max tokens: 250
   - Temperature: 0.3 (deterministic)
   - Use case: Extract relevant info from documents

3. **Query Classification**:
   - Determine if query is about: content, enclave, or chat
   - Used for SMS response routing

### AI Response Types

**`summary`**: Extract specific information
- Prompt: "Return ALL relevant details about query"
- Examples: "when is active meeting" → "Active meetings are Wednesdays at 8 PM at..."

**`general``**: Conversational response
- Prompt: "Respond as a helpful assistant"
- Use case: Chatty responses for non-content queries

---

## 7. PERFORMANCE OPTIMIZATIONS

### Caching
- **API Cache**: Resource lists cached per user
- **Invalidation**: Clear cache on upload/update/delete
- **TTL**: 5 minutes default

### Async Processing
- **Embeddings**: Generated asynchronously after upload
- **Best-effort**: Failure doesn't block upload
- **Retry logic**: Attempts multiple Mistral models

### Database Indexes
- `resource_embedding.embedding`: pgvector index (HNSW)
- `sms_optin.phone`: Unique index
- `space_id` on all tables: For workspace filtering

### Query Optimization
- **Parallel searches**: All sources searched simultaneously
- **Limit early**: Fetch 2x limit, return top results
- **Deduplication**: Remove duplicates before ranking

---

## 8. WORKFLOW SUMMARY

### Upload Flow:
```
1. User uploads file → Extract text
2. Insert into `resource` table
3. Async: Generate embedding → Store in `resource_embedding`
4. Async: Chunk text → Store in `resource_chunk`
5. Return success to user
```

### Query Flow:
```
1. User enters query → Generate query embedding
2. Parallel searches:
   - FTS: search_resources_fts
   - Vector: search_resources_vector
   - GDocs: search_google_docs_vector
   - Calendar: search_calendar_events_vector
   - Slack: search_slack_messages
3. Combine all results
4. Sort by score (relevance)
5. Return top 20 results
```

### SMS Query Flow:
```
1. Receive SMS → Validate signature
2. Check opt-in → Create session
3. Find SEP workspaces
4. Hybrid search across workspaces
5. Deduplicate results
6. Chunk large documents (1500 chars, 200 overlap)
7. Send each chunk to AI until answer found
8. Classify query (content/enclave/chat)
9. Format response
10. Split if too long (>1600 chars)
11. Send SMS via Twilio
```

---

## File Locations

- **Search Logic**: `src/lib/search.ts`
- **Embeddings**: `src/lib/embeddings.ts`
- **Google Docs**: `src/lib/google-docs.ts`
- **Slack**: `src/lib/slack.ts`
- **SMS Handler**: `src/app/api/twilio/sms/route.ts`
- **AI API**: `src/app/api/ai/route.ts`
- **Upload API**: `src/app/api/upload/route.ts`
- **Database Schema**: `database/schema.sql`
- **Search Functions**: `database/search-function.sql`

---

Generated: 2025-10-28
