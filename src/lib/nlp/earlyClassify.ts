export type EarlyIntent = {
  intent: 'content_query' | 'enclave_help' | 'action_request' | 'smalltalk' | 'abusive' | 'keyword'
  isSmalltalk: boolean
  isAbusive: boolean
  isPollAnswerLikely: boolean
}

export function earlyClassify(text: string, convoSummary: string = ''): EarlyIntent {
  const t = (text || '').trim()
  const lower = t.toLowerCase()

  // Keywords
  if (/^(stop|start|help)$/i.test(t)) return { intent: 'keyword', isSmalltalk: false, isAbusive: false, isPollAnswerLikely: false }

  // Abuse
  const abusive = /(retard|retarded|idiot|stupid|dumb|kill yourself)/i.test(lower)

  // Smalltalk
  const small = /^(yo|hey|hi|hello|sup|what's up|whats up|wassup|wyd|ok|k|bet|fine bro)$/i.test(lower)

  // Enclave product queries
  const enclave = /(what do you do|how do you work|what are you|what is enclave|enclave)/i.test(lower)

  // Poll answer likelihood: short, non-question; number or simple yes/no/maybe
  const likelyPoll = (() => {
    if (lower.length === 0 || lower.length > 24) return false
    if (abusive) return false
    if (lower.endsWith('?')) return false
    if (/^\d{1,2}$/.test(lower)) return true
    const cleaned = lower.replace(/[^a-z0-9\s]/g, '').trim()
    return ['yes', 'no', 'maybe', 'y', 'n', 'a', 'b', 'c', 'd'].includes(cleaned)
  })()

  if (abusive) return { intent: 'abusive', isSmalltalk: small, isAbusive: true, isPollAnswerLikely: false }
  if (small) return { intent: 'smalltalk', isSmalltalk: true, isAbusive: false, isPollAnswerLikely: false }
  if (enclave) return { intent: 'enclave_help', isSmalltalk: false, isAbusive: false, isPollAnswerLikely: false }
  return { intent: 'content_query', isSmalltalk: false, isAbusive: false, isPollAnswerLikely: likelyPoll }
}


