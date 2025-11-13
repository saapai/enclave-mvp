# SMS Context-Aware System Integration Guide

## Quick Start

The new context-aware system can be integrated into your existing SMS route handler. Here's how:

## Option 1: Gradual Integration (Recommended)

### Step 1: Add the unified handler as an alternative path

In `src/app/api/twilio/sms/route.ts`, add this after the initial validation and before the existing logic:

```typescript
import { handleSMSMessage } from '@/lib/sms/unified-handler'

// After validation, add feature flag check:
const USE_NEW_HANDLER = process.env.USE_NEW_SMS_HANDLER === 'true'

if (USE_NEW_HANDLER) {
  try {
    const result = await handleSMSMessage(phoneNumber, from, body)
    
    // Save conversation history
    if (result.shouldSaveHistory) {
      await supabase.from('sms_conversation_history').insert({
        phone_number: phoneNumber,
        user_message: body,
        bot_response: result.response
      })
    }
    
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${result.response}</Message></Response>`,
      { headers: { 'Content-Type': 'application/xml' } }
    )
  } catch (err) {
    console.error('[Twilio SMS] New handler error:', err)
    // Fall through to existing handler
  }
}

// Continue with existing handler logic...
```

### Step 2: Enable for testing

Set environment variable:
```bash
USE_NEW_SMS_HANDLER=true
```

### Step 3: Monitor and iterate

- Check logs for intent classification
- Verify welcome flow works
- Test announcement/poll commands
- Gradually migrate features

## Option 2: Full Integration

Replace the intent classification and routing logic with the unified handler:

```typescript
import { handleSMSMessage } from '@/lib/sms/unified-handler'

export async function POST(request: NextRequest) {
  try {
    // ... validation code ...
    
    // Handle commands first (STOP, START, HELP)
    const command = body?.trim().toUpperCase()
    if (command === 'STOP' || command === 'START' || command === 'HELP') {
      // Keep existing command handling
      // ...
    }
    
    // Use unified handler for everything else
    const result = await handleSMSMessage(phoneNumber, from, body)
    
    // Save conversation history
    if (result.shouldSaveHistory) {
      await supabase.from('sms_conversation_history').insert({
        phone_number: phoneNumber,
        user_message: body,
        bot_response: result.response
      })
    }
    
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${result.response}</Message></Response>`,
      { headers: { 'Content-Type': 'application/xml' } }
    )
  } catch (error) {
    // Error handling
  }
}
```

## Integration Points

### 1. Query Handling

The unified handler currently returns a placeholder for queries. To integrate with existing query handler:

```typescript
// In unified-handler.ts, update handleQuery function:
async function handleQuery(
  phoneNumber: string,
  messageText: string,
  intentType: IntentType
): Promise<HandlerResult> {
  // Import and use existing query handler
  const { handleQuery as existingQueryHandler } = await import('@/lib/orchestrator/handleTurn')
  const result = await existingQueryHandler(phoneNumber, messageText)
  
  return {
    response: result.messages.join('\n\n'),
    shouldSaveHistory: true,
    metadata: { intent: intentType }
  }
}
```

### 2. Poll Response Handling

Integrate with existing poll response logic:

```typescript
async function handlePollResponse(
  phoneNumber: string,
  messageText: string
): Promise<HandlerResult> {
  // Use existing poll response handler
  const { recordPollResponse } = await import('@/lib/polls')
  // ... existing logic ...
}
```

### 3. Announcement/Poll Sending

Integrate with existing sending logic:

```typescript
async function handleControlCommand(
  phoneNumber: string,
  messageText: string
): Promise<HandlerResult> {
  const lower = messageText.toLowerCase().trim()
  
  if (/^(send\s+it|send\s+now)/i.test(lower)) {
    // Get draft and send using existing logic
    const { sendAnnouncement } = await import('@/lib/announcements')
    // ... existing sending logic ...
  }
}
```

## Testing Checklist

- [ ] Welcome flow works for new users
- [ ] Name detection and Airtable sync
- [ ] Announcement creation with instructions
- [ ] Verbatim announcement handling
- [ ] Poll creation
- [ ] Query handling (integrate existing)
- [ ] Control commands (send it, cancel)
- [ ] Context awareness (follow-up messages)

## Environment Variables

Ensure these are set:
```bash
MISTRAL_API_KEY=your_key
AIRTABLE_API_KEY=your_key
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=your_table_name
```

## Troubleshooting

### LLM calls failing
- Check MISTRAL_API_KEY is set
- Verify API quota/limits
- Check network connectivity

### Airtable sync not working
- Verify AIRTABLE_* env vars
- Check field names match your table
- Review logs for specific errors

### Intent misclassification
- Check conversation history is loading
- Review LLM responses in logs
- Adjust confidence thresholds if needed

## Next Steps

1. Test with a few users
2. Monitor logs and metrics
3. Iterate on intent classification
4. Enhance query integration
5. Add more features (scheduling, templates, etc.)



