# Robotic Response Analysis

## 🔍 Root Causes

### 1. **Knowledge Graph SQL Error (Not Fixed in Production)**
```
Error: invalid UNION/INTERSECT/EXCEPT ORDER BY clause
```
**Impact**: Every query tries knowledge graph first, fails, falls back to doc search with inconsistent results.

**Fix**: Run the SQL fix in `database/fix-knowledge-graph-functions.sql` in Supabase SQL Editor.

### 2. **Intent Classification Too Aggressive**
**Problem**: Queries like "What's going on" were being classified as `chat` instead of `content`, leading to generic responses.

**Example**:
- "What's going on with sep" → Chat intent → "All good here!"
- Should be: Content intent → Search and return comprehensive info

**Fixed in: Latest commit** - Now properly detects content vs chat queries.

### 3. **No Conversation State Management**
**Problem**: The bot doesn't remember what it just searched for or what the user is interested in.

**Example Flow**:
```
User: "What's going on?"
Bot: [Searches, finds "Active meeting Wednesday"]
Bot: "This Wednesday: Active meeting, Study hall..."

User: "When is that?"
Bot: [No context] → "Wednesday at Mahi's apartment"
```

**Missing**: Conversation context should make "When is that?" work.

### 4. **AI Summarization Returning Same Answer**
**Problem**: The AI is finding one chunk and returning it for everything.

**Why it happens**:
1. Knowledge graph fails (SQL error)
2. Falls back to doc search
3. Returns "Active meeting" doc
4. AI summarizes "Wednesday at Mahi's apartment"
5. SAME answer for every query

**Evidence from logs**:
```
"What's up" → "Wednesday at Mahi's apartment..."
"What's going on" → "Wednesday at Mahi's apartment..."
"Tell me more" → "Wednesday at Mahi's apartment..."
```

### 5. **Search Results Not Being Properly Ranked**
**Problem**: "What's going on" should return:
1. Study Hall
2. Active Meeting
3. Creatathon
4. Big Little
5. etc.

But it's only returning "Active meeting" because that's the top search result.

## 🎯 Solutions Applied

### ✅ Fix 1: Smarter Intent Detection
```typescript
// OLD: "What's going on" → Chat
if (isChat) return chat

// NEW: "What's going on" → Content
if (isContentQuery) return contentSearch()
if (isPureChat) return chat
```

**Result**: "What's going on with sep" now properly searches and returns comprehensive info.

### ✅ Fix 2: Content Query Patterns
- "What's happening" → content
- "What's going on" → content  
- "What's upcoming" → content
- "Tell me about" → content
- "What is" → content
- "When is" → event lookup
- "Hi" / "Hello" → pure chat

### ⚠️ Fix 3: Knowledge Graph SQL (NEEDS TO BE RUN)
The production database still has the old broken SQL. Run the fix:

**Go to Supabase → SQL Editor → Paste this**:
```sql
-- File: database/fix-knowledge-graph-functions.sql
CREATE OR REPLACE FUNCTION find_event_by_name(
  search_name TEXT,
  target_space_id UUID
)
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  location TEXT,
  match_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH direct_matches AS (
    SELECT 
      e.id,
      e.name,
      e.start_at,
      e.end_at,
      e.location,
      'direct'::TEXT as match_type
    FROM event e
    WHERE e.space_id = target_space_id
      AND e.name ILIKE '%' || search_name || '%'
  ),
  alias_matches AS (
    SELECT 
      e.id,
      e.name,
      e.start_at,
      e.end_at,
      e.location,
      'alias'::TEXT as match_type
    FROM event e
    JOIN event_alias ea ON ea.event_id = e.id
    WHERE e.space_id = target_space_id
      AND ea.alias ILIKE '%' || search_name || '%'
  )
  SELECT * FROM direct_matches
  UNION ALL
  SELECT * FROM alias_matches
  ORDER BY match_type, event_name
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;
```

## 🚀 Remaining Issues

### 1. **AI Response Quality**
The AI is being too conservative with `max_tokens`. For "What's going on", it should give a comprehensive answer (200-250 tokens), but it's being cut off.

**Current**: 
```typescript
maxTokens = isBroadQuery ? 200 : (isSpecificQuery ? 100 : 150)
```

**Should be**:
```typescript
maxTokens = isBroadQuery ? 250 : (isSpecificQuery ? 80 : 150)
```

### 2. **Multi-Result Summarization**
When "What's going on" returns multiple events, the AI should summarize ALL of them, not just the top one.

**Current**: Takes top result, summarizes it, returns answer.

**Should be**: Takes top 5 results, summarizes all relevant ones into one comprehensive response.

### 3. **Conversation Memory**
The bot doesn't remember recent queries or provide context-aware follow-ups.

**Example**:
```
User: "What's happening this week?"
Bot: "Study Hall Wed, Active Meeting Wed 8pm, Creatathon Nov 8..."

User: "Tell me more about the meeting"
Bot: [No context] → Should understand "meeting" = "Active Meeting" from context
```

**Fix Needed**: Use `sms_conversation_history` to maintain context across messages.

## 📊 Current Behavior After Fixes

### ✅ Working Well Now:
- "What's going on" → Searches and returns content
- "What's happening" → Searches and returns content
- "When is active meeting" → Specific event query
- "Hi" → Pure chat, friendly response

### ⚠️ Still Issues:
- "What's happening" returning the same answer for every query
- Knowledge graph failing (SQL not run in production)
- AI token limits too restrictive for broad queries
- Missing multi-event summarization

## 🎯 Next Steps

1. **Run SQL Fix**: Execute `database/fix-knowledge-graph-functions.sql` in Supabase
2. **Increase Token Limits**: For broad queries, allow more context
3. **Multi-Result Summarization**: Summarize top 3-5 results into one answer
4. **Test**: Query "What's going on" should return comprehensive SEP info

