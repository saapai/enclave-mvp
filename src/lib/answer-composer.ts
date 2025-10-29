/**
 * Deterministic Answer Composer
 * Enforces consistent answer shapes and sanitization
 */

// Bad words filter
const BAD_WORDS = /\b(ass|dumbass|shit|fuck)\b/gi;

function sanitize(text: string): string {
  return text.replace(BAD_WORDS, '—').replace(/\n{3,}/g, '\n\n');
}

export interface Answer {
  headline: string;    // the one-liner answer
  details?: string;    // ≤ 1 extra sentence
  sources?: {title: string; tag: string}[];  // short labels
}

export interface EventData {
  name: string;
  start_at?: string;
  end_at?: string;
  location?: string;
  required?: boolean;
}

export interface DocumentResult {
  title: string;
  body: string;
  source?: string;
}

/**
 * Compose event answer with consistent shape
 */
export function composeEventAnswer(event: EventData): Answer {
  let headline = '';
  let details = '';
  
  // Format headline
  const timeStr = event.start_at 
    ? new Date(event.start_at).toLocaleString('en-US', { 
        weekday: 'short', 
        hour: 'numeric', 
        minute: '2-digit' 
      })
    : 'TBD';
  
  const locationStr = event.location ? ` @ ${event.location}` : '';
  headline = `${event.name}: ${timeStr}${locationStr}`;
  
  // Add details
  if (event.required) {
    details = 'Attendance required.';
  }
  
  // Add location details if present
  if (event.location && event.location.includes('Kelton')) {
    details += ' Usually held at 461B Kelton or 610 Levering.';
  }
  
  return {
    headline: sanitize(headline),
    details: sanitize(details),
    sources: [{title: 'SEP Fall Quarter', tag: '§' + event.name}]
  };
}

/**
 * Compose digest answer (multiple events)
 */
export function composeDigestAnswer(events: EventData[]): Answer {
  if (events.length === 0) {
    return {
      headline: 'No events scheduled this week.',
      sources: []
    };
  }
  
  const bullets = events.slice(0, 5).map(evt => {
    const timeStr = evt.start_at 
      ? new Date(evt.start_at).toLocaleString('en-US', { 
          weekday: 'short', 
          hour: 'numeric', 
          minute: '2-digit' 
        })
      : 'TBD';
    return `• ${evt.name}: ${timeStr}${evt.location ? ` @ ${evt.location}` : ''}`;
  }).join('\n');
  
  return {
    headline: `Upcoming @ SEP:\n${bullets}`,
    sources: [{title: 'Events KG', tag: 'digest'}]
  };
}

/**
 * Compose document answer with extraction
 */
export function composeDocumentAnswer(result: DocumentResult, query: string): Answer {
  const body = result.body || '';
  
  // Extract key info based on query intent
  const headline = extractAnswer(body, query);
  const details = extractDetails(body, query);
  
  return {
    headline: sanitize(headline),
    details: details ? sanitize(details) : undefined,
    sources: [{title: result.title, tag: result.source || 'doc'}]
  };
}

/**
 * Extract answer from document body
 */
function extractAnswer(body: string, query: string): string {
  const lowerQuery = query.toLowerCase();
  
  // Time/location extraction patterns
  if (lowerQuery.includes('when')) {
    const timeMatch = body.match(/every\s+(?:mon|tuesday?|wednesday?|thursday?|friday?|saturday?|sunday?)/i) ||
                      body.match(/\d{1,2}:\d{2}\s*PM/i) ||
                      body.match(/\d{1,2}:\d{2}\s*AM/i);
    
    if (timeMatch) {
      return body.substring(0, 200); // First 200 chars for context
    }
  }
  
  if (lowerQuery.includes('where')) {
    const locationMatch = body.match(/(?:@|at)\s+[A-Za-z0-9\s]+(?:apartment|hall|lounge|terrace)/i);
    if (locationMatch) {
      return body.substring(0, 200);
    }
  }
  
  // Default: return first sentence or 150 chars
  const firstSentence = body.split(/[.!?]/)[0];
  if (firstSentence.length < 150) {
    return firstSentence;
  }
  
  return body.substring(0, 150) + '...';
}

/**
 * Extract details for second sentence
 */
function extractDetails(body: string, query: string): string {
  // Only add details if meaningful context exists
  if (body.includes('Attendance') || body.includes('Required')) {
    return 'Attendance required.';
  }
  
  if (body.includes('alternates') || body.includes('usually')) {
    return body.match(/usually.+|alternates.+/i)?.[0] || '';
  }
  
  return '';
}

/**
 * Render answer to SMS text
 */
export function renderAnswer(answer: Answer): string {
  const parts: string[] = [answer.headline];
  
  if (answer.details) {
    parts.push(answer.details);
  }
  
  // Add source if meaningful
  if (answer.sources && answer.sources.length > 0 && answer.sources[0].tag.startsWith('§')) {
    parts.push(`Source: ${answer.sources[0].title}`);
  }
  
  return parts.filter(Boolean).join('\n');
}

/**
 * Check if query is a follow-up
 */
export function isFollowUp(query: string): boolean {
  const followUpPatterns = [
    /^(where|when|what|who|why|how)\s+\?*$/i,
    /^(yes|yep|yeah|sure|ok|okay|no|nope)\s*$/i,
    /^(tell me more|more info|details)\s*$/i,
    /^tell me about (it|that|them)\s*$/i
  ];
  
  return followUpPatterns.some(pattern => pattern.test(query.trim()));
}

