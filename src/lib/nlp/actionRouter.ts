/**
 * Deterministic Action Router
 * 
 * Routes messages to ACTION pipeline based on imperative verbs and patterns.
 * Runs BEFORE LLM classification to ensure action commands are handled deterministically.
 */

export type ActionIntent = 'ACTION' | 'PRODUCT_INFO' | 'ORG_INFO' | 'DRAFT_QUERY' | 'CHAT' | null

export interface ActionRoute {
  intent: ActionIntent
  confidence: number
  verb?: string
  operation?: 'create' | 'edit' | 'send' | 'schedule' | 'cancel' | 'delete' | 'query'
  target?: 'announcement' | 'poll'
}

/**
 * Imperative verb patterns that indicate ACTION intent
 */
const IMPERATIVE_PATTERNS = [
  // Direct commands
  /^(send|make|change|edit|update|schedule|cancel|post|announce|draft|set|add|remove|delete)\s/i,
  // Make it / change it / update it
  /^(make|change|update|edit)\s+(it|the)\s+(say|to|that)/i,
  // Announcement/poll specific
  /(announce|poll|send out|broadcast|create)\s+(an?\s+)?(announcement|poll)/i,
  // Time/date/location edits
  /(make|change|set|update)\s+.*\s+(to|at|for)\s+(?:(\d{1,2}:\d{2}|\d{1,2}(?:am|pm))|today|tomorrow|next\s+\w+)/i,
  // Copy/use what I wrote patterns
  /(copy|use|take)\s+(what|exactly\s+what)\s+(i|I)\s+(wrote|said|typed|sent)/i,
  /that'?s\s+(the\s+same\s+thing|what\s+i\s+wrote|exactly\s+what\s+i\s+wrote)/i,
  /can\s+you\s+(copy|use|take)\s+(what|exactly\s+what)\s+(i\s+)?(wrote|said|typed)/i,
]

/**
 * Determines if a message is an imperative action command
 */
function isImperative(message: string): boolean {
  const lower = message.toLowerCase().trim()
  
  // Check against imperative patterns
  for (const pattern of IMPERATIVE_PATTERNS) {
    if (pattern.test(lower)) {
      return true
    }
  }
  
  // Check for "make it say" / "change it to" patterns
  if (/^make\s+(it|the)\s+(say|say\s+that)/i.test(lower)) {
    return true
  }
  
  if (/^change\s+(it|the)\s+(to|say)/i.test(lower)) {
    return true
  }
  
  return false
}

/**
 * Extracts the operation type from an imperative message
 */
function extractOperation(message: string): 'create' | 'edit' | 'send' | 'schedule' | 'cancel' | 'delete' | undefined {
  const lower = message.toLowerCase()
  
  // Copy/use what I wrote patterns are always edit operations
  if (/(copy|use|take)\s+(what|exactly\s+what)\s+(i|I)\s+(wrote|said|typed|sent)/i.test(message)) return 'edit'
  if (/that'?s\s+(the\s+same\s+thing|what\s+i\s+wrote|exactly\s+what\s+i\s+wrote)/i.test(message)) return 'edit'
  if (/can\s+you\s+(copy|use|take)\s+(what|exactly\s+what)\s+(i\s+)?(wrote|said|typed)/i.test(message)) return 'edit'
  
  if (/^(send|broadcast)/i.test(message)) return 'send'
  if (/^(make|create|draft|announce)/i.test(message)) return 'create'
  if (/^(change|edit|update|make\s+(it|the)|set)/i.test(message)) return 'edit'
  if (/^(schedule|set\s+for)/i.test(message)) return 'schedule'
  if (/^(cancel|delete|remove)/i.test(message)) return 'cancel'
  
  return undefined
}

/**
 * Extracts the target (announcement or poll) from a message
 */
function extractTarget(message: string): 'announcement' | 'poll' | undefined {
  const lower = message.toLowerCase()
  
  if (lower.includes('announcement') || lower.includes('announce')) {
    return 'announcement'
  }
  if (lower.includes('poll')) {
    return 'poll'
  }
  
  // If operation is "send" or "edit" and no explicit target, assume announcement
  // (polls are usually explicit)
  return undefined
}

/**
 * Determines if message is asking about Enclave (the product)
 */
function isProductInfoQuery(message: string): boolean {
  const lower = message.toLowerCase()
  const patterns = [
    /^(what|who|how|when|where)\s+(is|are|was|were|do|does|did)\s+enclave/i,
    /^enclave\s+(is|what|how|who)/i,
    /^(who|what)\s+built\s+enclave/i,
    /^enclave\s+(capabilities|features|can|does)/i,
  ]
  
  return patterns.some(p => p.test(lower))
}

/**
 * Determines if message is asking about SEP/organization content
 */
function isOrgInfoQuery(message: string): boolean {
  const lower = message.toLowerCase()
  const patterns = [
    /^(when|where|what|who|how)\s+(is|are|was|were)\s+/i,
    /^(tell\s+me|show\s+me|what's|whats)\s+(about|when|where)/i,
  ]
  
  // Must NOT be an imperative
  if (isImperative(message)) return false
  
  return patterns.some(p => p.test(lower))
}

/**
 * Determines if message is asking about the draft (special query type)
 */
function isDraftQuery(message: string): boolean {
  const lower = message.toLowerCase().trim()
  const patterns = [
    /^(what|show|tell\s+me)\s+(is\s+)?(the\s+)?(draft|announcement\s+draft|poll\s+draft)/i,
    /^(what|show)\s+(does|will)\s+(the\s+)?(draft|announcement|poll)\s+(say|look\s+like)/i,
    /^(show|tell\s+me)\s+(the\s+)?(draft|announcement|poll)/i,
  ]
  
  return patterns.some(p => p.test(lower))
}

/**
 * Determines if message is smalltalk (thank you, greetings, etc.)
 */
function isSmalltalk(message: string): boolean {
  const lower = message.toLowerCase().trim()
  const smalltalkPatterns = [
    /^(thanks?|thank\s+you|ty|thx|appreciate\s+it)/i,
    /^(hi|hey|hello|sup|what'?s\s+up|yo)/i,
    /^(ok|okay|alright|sure|got\s+it|sounds\s+good)/i,
    /^(cool|nice|sweet|awesome|great)/i,
  ]
  
  return smalltalkPatterns.some(p => p.test(lower)) && lower.length < 50
}

/**
 * Routes a message to the appropriate pipeline
 * 
 * Priority: ACTION > DRAFT_QUERY > PRODUCT_INFO > ORG_INFO > CHAT
 */
export function routeAction(message: string, hasActiveDraft: boolean): ActionRoute {
  // Priority 1: ACTION (imperative commands)
  if (isImperative(message)) {
    const operation = extractOperation(message)
    const target = extractTarget(message)
    
    // If user says "make it" or "change it" and has active draft, it's definitely an edit
    if (hasActiveDraft && (operation === 'edit' || /^(make|change)\s+(it|the)/i.test(message))) {
      return {
        intent: 'ACTION',
        confidence: 0.95,
        verb: operation || 'edit',
        operation: 'edit',
        target: target || 'announcement'
      }
    }
    
    // Special case: "copy what I wrote" with active draft is definitely an edit
    if (hasActiveDraft && (operation === 'edit' || /(copy|use|take)\s+(what|exactly\s+what)\s+(i|I)\s+(wrote|said)/i.test(message))) {
      return {
        intent: 'ACTION',
        confidence: 0.95,
        verb: 'edit',
        operation: 'edit',
        target: target || 'announcement'
      }
    }
    
    return {
      intent: 'ACTION',
      confidence: 0.9,
      verb: operation,
      operation: operation || 'create',
      target: target || 'announcement'
    }
  }
  
  // Priority 2: DRAFT_QUERY (asking about draft content - only if draft exists)
  if (hasActiveDraft && isDraftQuery(message)) {
    return {
      intent: 'DRAFT_QUERY',
      confidence: 0.95,
      operation: 'query'
    }
  }
  
  // Priority 3: Smalltalk (short, polite messages)
  if (isSmalltalk(message)) {
    return {
      intent: 'CHAT',
      confidence: 0.9
    }
  }
  
  // Priority 4: PRODUCT_INFO (questions about Enclave)
  if (isProductInfoQuery(message)) {
    return {
      intent: 'PRODUCT_INFO',
      confidence: 0.9
    }
  }
  
  // Priority 5: ORG_INFO (questions about SEP/org content)
  if (isOrgInfoQuery(message)) {
    return {
      intent: 'ORG_INFO',
      confidence: 0.8
    }
  }
  
  // Default: CHAT (unclear intent)
  return {
    intent: 'CHAT',
    confidence: 0.5
  }
}

