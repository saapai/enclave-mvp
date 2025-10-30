export type PrimaryIntent = 'content_query' | 'enclave_help' | 'action_request' | 'smalltalk' | 'abusive' | 'keyword'

export type RouteFlags = {
  timewords: boolean
  personQuery: boolean
  followUp: boolean
  unsupportedAction?: boolean
}

export type RouteResult = {
  intent: PrimaryIntent
  flags: RouteFlags
}

const STOP_WORDS = ['STOP', 'START', 'HELP']

export function classifyIntent(text: string, recentSummary: string = ''): RouteResult {
  const t = (text || '').trim()
  const lower = t.toLowerCase()

  // Hard keyword routing
  if (STOP_WORDS.includes(t.toUpperCase())) return { intent: 'keyword', flags: baseFlags(lower, recentSummary) }
  // Detect action requests - supported ones (announcements/polls) vs unsupported (gcal invites, calendar sync, etc.)
  if (/\b(send.*gcal|google.*calendar.*invite|add.*to.*calendar|sync.*calendar|create.*event)/i.test(lower)) {
    return { intent: 'action_request', flags: { ...baseFlags(lower, recentSummary), unsupportedAction: true } }
  }
  if (/\b(announce|blast|broadcast|send|schedule|remind|poll|vote)\b/.test(lower)) return { intent: 'action_request', flags: baseFlags(lower, recentSummary) }

  // Abusive (very light check; full moderation can replace)
  if (/(\bfuck\b|\bstupid\b|\bidiot\b)/.test(lower)) return { intent: 'abusive', flags: baseFlags(lower, recentSummary) }

  // Enclave/Jarvis product questions - recognize both names
  if (/(what is enclave|how.*enclave|who.*built.*enclave|enclave.*feature|what is jarvis|how.*jarvis|who.*built.*jarvis|who.*made.*jarvis|who.*created.*jarvis|jarvis.*feature|capab|what do you do|how do you work|what are you)/.test(lower)) {
    return { intent: 'enclave_help', flags: baseFlags(lower, recentSummary) }
  }

  // Content heuristics
  if (/\b(when|where|who|what|how)\b/.test(lower) || lower.length > 20) return { intent: 'content_query', flags: baseFlags(lower, recentSummary) }

  // Default smalltalk
  return { intent: 'smalltalk', flags: baseFlags(lower, recentSummary) }
}

function baseFlags(lower: string, recent: string): RouteFlags {
  return {
    timewords: /(today|tomorrow|yesterday|tonight|this week|next week|in \d+ (min|hour|day|week)s?)/.test(lower),
    personQuery: /(who is|who's|whos)\s+/.test(lower),
    followUp: /(that|then|as i said|like i said)/.test(lower) || recent.length > 0,
  }
}


