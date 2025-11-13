# SMS Context-Aware System

## Overview

This document describes the new context-aware SMS bot system that provides fluid, dynamic handling of user messages with full conversational awareness.

## Architecture

### Core Components

1. **Context-Aware Intent Classifier** (`src/lib/sms/context-aware-classifier.ts`)
   - Uses weighted conversation history (last 5-10 messages)
   - LLM-based intent classification with fallback rules
   - Understands conversational context

2. **Smart Command Parser** (`src/lib/sms/smart-command-parser.ts`)
   - Parses announcement/poll commands intelligently
   - Distinguishes verbatim text vs. generated content
   - Extracts instructions and constraints

3. **Welcome Flow Handler** (`src/lib/sms/welcome-flow.ts`)
   - Conversational welcome: "I'm Jarvis, part of Enclave, what's your name?"
   - Automatic Airtable sync
   - Setup completion: "You're all set up!"

4. **Enhanced Announcement Generator** (`src/lib/sms/enhanced-announcement-generator.ts`)
   - Respects verbatim constraints
   - Follows instructions (e.g., "make sure to say it's at 9am")
   - Generates natural announcements

5. **Unified Handler** (`src/lib/sms/unified-handler.ts`)
   - Main orchestration layer
   - Routes messages to appropriate handlers
   - Manages state and drafts

## Intent Types

- `content_query`: Questions about documents, events, resources
- `enclave_query`: Questions about Enclave itself
- `random_conversation`: Casual chat, greetings, smalltalk
- `announcement_command`: Create/send announcement
- `poll_command`: Create/send poll
- `poll_response`: Response to active poll
- `announcement_edit`: Edit announcement draft
- `poll_edit`: Edit poll draft
- `name_declaration`: User stating their name
- `control_command`: send it, cancel, etc.

## Welcome Flow

1. **New User Detection**: Checks if user needs welcome
2. **Intro Message**: "hey! i'm jarvis, part of enclave. i can help you find info about events, docs, and more. what's your name?"
3. **Name Collection**: Detects name declarations using LLM
4. **Airtable Sync**: Automatically creates/updates Airtable record
5. **Setup Complete**: "you're all set up! feel free to ask me any questions."

## Smart Command Parsing

The system understands complex instructions:

### Verbatim Text
- "use my exact wording: meeting at 9am" → Uses exact text
- "send this exactly: 'Active meeting tonight'" → Uses quoted text

### Instructions
- "send a message about study hall, make sure to say it's at 9am"
  - Generates content about study hall
  - Ensures time is mentioned

### Constraints
- `mustInclude`: Things that MUST be in the final message
- `mustNotChange`: Things that must NOT be changed
- `verbatimOnly`: Entire message should be verbatim

## Integration

### Basic Usage

```typescript
import { handleSMSMessage } from '@/lib/sms/unified-handler'

const result = await handleSMSMessage(
  phoneNumber,      // 10-digit phone
  fullPhoneNumber,  // E.164 format (+1...)
  messageText
)

// Save conversation history
if (result.shouldSaveHistory) {
  await supabase.from('sms_conversation_history').insert({
    phone_number: phoneNumber,
    user_message: messageText,
    bot_response: result.response
  })
}
```

### Integration into Route Handler

Replace the existing intent classification logic in `src/app/api/twilio/sms/route.ts` with:

```typescript
import { handleSMSMessage } from '@/lib/sms/unified-handler'

// In POST handler, after validation:
const result = await handleSMSMessage(phoneNumber, from, body)

// Save history
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
```

## Features

### Context Awareness
- Uses last 5-10 messages with weighting (more recent = higher weight)
- Understands conversational flow
- Handles follow-up questions naturally

### Dynamic Handling
- No hardcoded patterns
- LLM-based understanding
- Fallback to rules for reliability

### Smart Parsing
- Understands verbatim vs. generated content
- Extracts instructions and constraints
- Handles complex commands

### Welcome Flow
- Conversational introduction
- Automatic name detection
- Airtable integration

## Examples

### Announcement with Instructions
```
User: send out a message about study hall, make sure to say it's at 9am
Bot: okay, here's what the announcement will say:

study hall tonight at 9am! come through if you need help with anything.

reply "send it" to broadcast or reply to edit
```

### Verbatim Announcement
```
User: use my exact wording: Active meeting tonight at 8pm
Bot: okay, here's what the announcement will say:

Active meeting tonight at 8pm

reply "send it" to broadcast or reply to edit
```

### Welcome Flow
```
User: [first message]
Bot: hey! i'm jarvis, part of enclave. i can help you find info about events, docs, and more. what's your name?

User: I'm John
Bot: you're all set up! feel free to ask me any questions.
```

## Future Enhancements

- [ ] Integrate with existing query handler
- [ ] Enhanced poll generation
- [ ] Multi-turn conversation for complex announcements
- [ ] Template support
- [ ] Scheduled announcements



