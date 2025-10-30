export type EarlyIntent = {
  intent: 'content_query' | 'enclave_help' | 'action_request' | 'smalltalk' | 'abusive' | 'keyword'
  isSmalltalk: boolean
  isAbusive: boolean
  isPollAnswerLikely: boolean
  isMoreRequest?: boolean
  isConfusedFeedback?: boolean
}

export function earlyClassify(text: string, convoSummary: string = ''): EarlyIntent {
  const t = (text || '').trim()
  const lower = t.toLowerCase()

  // Keywords
  if (/^(stop|start|help)$/i.test(t)) return { intent: 'keyword', isSmalltalk: false, isAbusive: false, isPollAnswerLikely: false }

  // Abuse
  const abusive = /(retard|retarded|idiot|stupid|dumb|kill yourself)/i.test(lower)

  // Smalltalk - only exact matches, not queries about events/content
  const small = /^(yo|hey|hi|hello|sup|what's up|whats up|wassup|wyd|ok|k|bet|fine bro)$/i.test(lower) && !/(events?|schedule|calendar|when|where|who|what)/i.test(lower)

  // Feedback / expansion
  const moreReq = /^(more|tell me more|expand)$/i.test(t)
  const confused = /(doesn['’]?t make sense|does not make sense|idk what you mean|confusing)/i.test(lower)

  // Enclave/Jarvis product queries - recognize both names
  const enclave = /(what do you do|how do you work|what are you|what is enclave|enclave|what is jarvis|jarvis|who is jarvis|who built jarvis|who made jarvis|who created jarvis|who is enclave|who built enclave|who made enclave|who created enclave)/i.test(lower)

  // Poll answer likelihood: short, non-question; number or simple yes/no/maybe
  const likelyPoll = (() => {
    if (lower.length === 0 || lower.length > 24) return false
    if (abusive) return false
    if (lower.endsWith('?')) return false
    if (/^\d{1,2}$/.test(lower)) return true
    const cleaned = lower.replace(/[^a-z0-9\s]/g, '').trim()
    return ['yes', 'no', 'maybe', 'y', 'n', 'a', 'b', 'c', 'd'].includes(cleaned)
  })()

  // Content queries (events, schedule, etc.) - check before smalltalk
  const isContentQuery = /(events?|schedule|calendar|when|where|who|what|how)/i.test(lower) && !small
  
  if (abusive) return { intent: 'abusive', isSmalltalk: small, isAbusive: true, isPollAnswerLikely: false, isMoreRequest: moreReq, isConfusedFeedback: confused }
  if (enclave) return { intent: 'enclave_help', isSmalltalk: false, isAbusive: false, isPollAnswerLikely: false, isMoreRequest: moreReq, isConfusedFeedback: confused }
  if (isContentQuery) return { intent: 'content_query', isSmalltalk: false, isAbusive: false, isPollAnswerLikely: likelyPoll, isMoreRequest: moreReq, isConfusedFeedback: confused }
  if (small || moreReq || confused) return { intent: 'smalltalk', isSmalltalk: true, isAbusive: false, isPollAnswerLikely: false, isMoreRequest: moreReq, isConfusedFeedback: confused }
  return { intent: 'content_query', isSmalltalk: false, isAbusive: false, isPollAnswerLikely: likelyPoll, isMoreRequest: moreReq, isConfusedFeedback: confused }
}


