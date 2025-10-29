# Build Poke-Like Bot - Implementation Guide

Based on root cause analysis, here's what needs to be fixed in order.

## 🔧 CRITICAL FIXES (Do First)

### 1. Fix Knowledge Graph SQL Error
**Location**: Supabase SQL Editor  
**File**: `database/fix-knowledge-graph-functions.sql`

```sql
-- Copy this entire file into Supabase SQL Editor and run
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

### 2. Add Session Frame Schema
**Location**: Supabase SQL Editor  
**File**: `database/sms-session-frame.sql`

Copy entire file into Supabase SQL Editor and run.

### 3. Populate Knowledge Graph

**Option A**: Run consolidator locally
```bash
cd /path/to/enclave-mvp
./run-consolidator.sh
```

**Option B**: Trigger via API
```bash
curl -X POST https://www.tryenclave.com/api/internal/consolidate \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_INTERNAL_API_KEY" \
  -d '{"workspaceId":"YOUR_SEP_WORKSPACE_ID"}'
```

Verify events were created:
```sql
SELECT name, start_at, location FROM event WHERE space_id = 'YOUR_WORKSPACE_ID';
```

## 🚀 CODE INTEGRATIONS (Next)

### 4. Integrate Answer Composer into SMS Handler

**File**: `src/app/api/twilio/sms/route.ts`

**Add imports**:
```typescript
import { composeEventAnswer, composeDigestAnswer, composeDocumentAnswer, renderAnswer, isFollowUp } from '@/lib/answer-composer';
```

**Replace AI summarization block** (around line 500):
```typescript
// Instead of inline AI summarization, use deterministic composer
if (plan.intent === 'event_lookup' && dedupedResults.length > 0) {
  const topResult = dedupedResults[0];
  const answer = composeDocumentAnswer(topResult, query);
  finalText = renderAnswer(answer);
} else if (plan.intent === 'content' && dedupedResults.length > 0) {
  // For "what's going on" queries, provide digest
  const answer = composeDigestAnswer(dedupedResults.slice(0, 5));
  finalText = renderAnswer(answer);
}
```

### 5. Add Session Frame Handling

**File**: `src/app/api/twilio/sms/route.ts`

**At the start of POST handler** (after getting workspace IDs):
```typescript
// Get or create session with rolling TTL
const { data: session } = await supabase.rpc('get_or_create_sms_session', {
  p_phone_number: phoneNumber,
  p_workspace_id: spaceIds[0]
});

if (!session) {
  console.error('[Twilio SMS] Failed to get/create session');
  return new NextResponse('Error', { status: 500 });
}

const frame = session.frame || {};

// Check if query is a follow-up
if (isFollowUp(query) && frame.last_event_slug) {
  // Use frame context for follow-up queries
  query = `when is ${frame.last_event_slug}`;
  console.log(`[Twilio SMS] Detected follow-up, using: "${query}"`);
}

// Update frame after processing
const newFrame = {
  last_query: query,
  last_intent: plan.intent,
  last_event_slug: extractEventSlug(dedupedResults),
  last_timestamp: new Date().toISOString()
};

await supabase.rpc('update_sms_frame', {
  p_session_id: session.id,
  p_frame_updates: newFrame
});
```

### 6. Add Digest Tool for Broad Queries

**File**: `src/lib/planner.ts`

**Add to `executeTool` function**:
```typescript
case 'digest':
  return await executeDigestTool(tool.params)
```

**Add new function**:
```typescript
async function executeDigestTool(params: any): Promise<ToolResult> {
  const days = params.days || 7;
  
  // Query upcoming events from knowledge graph
  const { data: events } = await supabase
    .from('event')
    .select('name, start_at, location')
    .gte('start_at', new Date().toISOString())
    .lte('start_at', new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString())
    .order('start_at', { ascending: true })
    .limit(6);
  
  return {
    tool: 'digest',
    success: true,
    data: { events: events || [] },
    confidence: 0.8
  };
}
```

**Update planner to route broad queries to digest**:
```typescript
// In fallbackPlan function
if (lowerQuery.match(/what's (going on|happening|up|upcoming)/i)) {
  return {
    intent: 'digest',
    confidence: 0.9,
    entities: {},
    tools: [{ tool: 'digest', params: { days: 7 }, priority: 1 }]
  };
}
```

## 📊 TESTING CHECKLIST

After implementing the above:

1. **Test Knowledge Graph**:
   - Text: "When is active meeting"
   - Should return: Structured event data with time/location
   - Check logs: No "Knowledge Graph Error" messages

2. **Test Session Persistence**:
   - Text: "What's going on"
   - Bot: Returns digest
   - Text: "Where?"
   - Bot: Should use session context

3. **Test Answer Format**:
   - Answers should have consistent shape
   - No bad words in responses
   - Proper time/location formatting

4. **Test Digest Tool**:
   - Text: "What's happening this week"
   - Should return: Bullet list of upcoming events

## 🎯 EXPECTED BEHAVIOR

### Before Fixes:
```
User: "When is active meeting"
Bot: "This Wednesday at Mahi's apartment. Saathvik will be presenting an ass presentation."

User: "What's up"
Bot: "This Wednesday at Mahi's apartment..."  // Same answer!
```

### After Fixes:
```
User: "When is active meeting"
Bot: "Active Meeting: Wed 8:00 PM @ Mahi's (461B Kelton)\nAttendance required."

User: "What's going on"
Bot: "Upcoming @ SEP:\n• Study Hall: Wed 6:30 PM @ Rieber Terrace\n• Active Meeting: Wed 8:00 PM @ 461B Kelton\n• Creatathon: Nov 8"
```

## 🔍 MONITORING

Watch logs for:
- ✅ `[search_knowledge] Found X events` (not "Error finding event")
- ✅ `[Twilio SMS] Session frame: {...}` (not "No active session")
- ✅ `[Answer Composer] Rendering answer with shape: {headline, details, sources}`

## 📝 NEXT STEPS

1. Run SQL fixes in Supabase
2. Populate knowledge graph
3. Integrate answer composer
4. Add session frame handling
5. Test end-to-end
6. Monitor and iterate

