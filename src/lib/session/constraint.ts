/**
 * Constraint Parser
 * 
 * Deterministic extraction of verbatim text and constraints.
 * This runs BEFORE any LLM calls and is untouchable.
 * 
 * Priority:
 * 1. Quoted text ("..." or '...')
 * 2. Explicit keywords (exact, exactly, verbatim, with this exact text)
 * 3. Colon patterns (say this: ..., with this exact text: ...)
 */

import { VerbatimConstraint } from './types'

/**
 * Extract quoted spans from text (both single and double quotes, including smart quotes)
 */
function extractQuotes(text: string): string[] {
  const quotes: string[] = []
  
  // Handle double quotes (regular and smart)
  const doubleQuoteRegex = /[""""]([^""""]+)["""]/g
  let match: RegExpExecArray | null
  while ((match = doubleQuoteRegex.exec(text)) !== null) {
    quotes.push(match[1].trim())
  }
  
  // Handle single quotes (regular and smart) - only if no double quotes found
  if (quotes.length === 0) {
    const singleQuoteRegex = /['']([^'']+)['']/g
    while ((match = singleQuoteRegex.exec(text)) !== null) {
      quotes.push(match[1].trim())
    }
  }
  
  return quotes
}

/**
 * Check if text contains explicit verbatim keywords
 */
function hasVerbatimKeywords(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /\b(exact|exactly|verbatim)\b/.test(lower) ||
    lower.includes('exact text') ||
    lower.includes('exact wording') ||
    lower.includes('exact message') ||
    lower.includes('my exact') ||
    lower.includes('this exact') ||
    lower.includes('use this exact') ||
    lower.includes('with this exact') ||
    lower.includes('send this exact') ||
    lower.includes('say exactly') ||
    lower.includes('word for word')
  )
}

/**
 * Extract text after colon in verbatim patterns
 */
function extractColonPattern(text: string): string | null {
  // Patterns: "with this exact text:", "say this:", "send:", "verbatim:", etc.
  const patterns = [
    /(?:with\s+this\s+exact\s+(?:text|wording|message)|say\s+this|send\s+this|verbatim|exact\s+text)\s*:\s*(.+)$/is,
    /(?:use\s+this\s+exact|send\s+this\s+exact)\s*:\s*(.+)$/is,
  ]
  
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return match[1].trim()
    }
  }
  
  return null
}

/**
 * Parse verbatim constraint from message
 * 
 * Returns the verbatim text and source in priority order:
 * 1. Quoted text (highest priority)
 * 2. Text after colon in verbatim pattern
 * 3. Full message if explicit keyword present
 * 4. null if no verbatim constraint
 */
export function parseVerbatimConstraint(message: string): VerbatimConstraint {
  // Priority 1: Quoted text
  const quotes = extractQuotes(message)
  if (quotes.length > 0) {
    // If multiple quotes and user says "include all", join them
    const lower = message.toLowerCase()
    const includeAll = lower.includes('include all') || lower.includes('both') || quotes.length === 1
    
    return {
      is_verbatim: true,
      text: includeAll ? quotes.join(' ') : quotes[0],
      source: 'quoted'
    }
  }
  
  // Priority 2: Colon pattern (e.g., "with this exact text: ...")
  const colonText = extractColonPattern(message)
  if (colonText) {
    return {
      is_verbatim: true,
      text: colonText,
      source: 'colon_pattern'
    }
  }
  
  // Priority 3: Explicit keyword present
  if (hasVerbatimKeywords(message)) {
    // Extract the actual content (remove command words)
    let text = message
    
    // Remove common command prefixes
    text = text.replace(/^(no,?\s+)?(?:with\s+this\s+exact\s+(?:text|wording|message)|use\s+my\s+exact\s+wording|say\s+exactly|use\s+this\s+exact)\s*:?\s*/i, '')
    text = text.replace(/^(no,?\s+)?(?:edit\s+it\s+to\s+this\s+exactly|make\s+it\s+say\s+exactly|change\s+it\s+to\s+exactly)\s*:?\s*/i, '')
    
    // If we extracted something meaningful, use it
    if (text.length > 5 && text.length < message.length) {
      return {
        is_verbatim: true,
        text: text.trim(),
        source: 'explicit_keyword'
      }
    }
  }
  
  // No verbatim constraint
  return {
    is_verbatim: false,
    source: 'none'
  }
}

/**
 * Parse "make sure to include X" constraints
 */
export function parseMustInclude(message: string): string[] {
  const mustInclude: string[] = []
  const lower = message.toLowerCase()
  
  // Pattern: "make sure to say/mention/include X"
  const patterns = [
    /make\s+sure\s+(?:to\s+)?(?:say|mention|include)\s+["']?([^"'\n]+)["']?/gi,
    /don'?t\s+forget\s+(?:to\s+)?(?:say|mention|include)\s+["']?([^"'\n]+)["']?/gi,
    /be\s+sure\s+to\s+(?:say|mention|include)\s+["']?([^"'\n]+)["']?/gi,
  ]
  
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(lower)) !== null) {
      const phrase = match[1].trim()
      if (phrase.length > 0) {
        mustInclude.push(phrase)
      }
    }
  }
  
  return mustInclude
}

/**
 * Parse "don't change X" constraints
 */
export function parseMustNotChange(message: string): string[] {
  const mustNotChange: string[] = []
  const lower = message.toLowerCase()
  
  // Pattern: "don't change the time/location/etc"
  const patterns = [
    /don'?t\s+change\s+(?:the\s+)?(time|location|place|date|where|when)/gi,
    /keep\s+(?:the\s+)?(time|location|place|date|where|when)\s+(?:the\s+)?same/gi,
    /(?:time|location|place|date)\s+stays?\s+(?:the\s+)?same/gi,
  ]
  
  const fieldMap: Record<string, string> = {
    'time': 'time',
    'when': 'time',
    'location': 'location',
    'place': 'location',
    'where': 'location',
    'date': 'date',
  }
  
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(lower)) !== null) {
      const field = match[1].toLowerCase()
      const canonicalField = fieldMap[field]
      if (canonicalField && !mustNotChange.includes(canonicalField)) {
        mustNotChange.push(canonicalField)
      }
    }
  }
  
  return mustNotChange
}

