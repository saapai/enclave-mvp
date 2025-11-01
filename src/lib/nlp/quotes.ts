/**
 * Quote extraction and parsing utilities
 * Implements RFC-style quote handling: all text in "quotes" is preserved verbatim
 */

/**
 * Extract all quoted segments from a message using regex /"([^"]+)"/g
 * Returns array of text content within quotes (quotes removed)
 */
export function extractQuotes(text: string): string[] {
  const matches = text.match(/"([^"]+)"/g)
  if (!matches) return []
  
  // Extract content within quotes and trim whitespace
  return matches.map(match => {
    const content = match.slice(1, -1) // Remove surrounding quotes
    return content.trim()
  })
}

/**
 * Remove all quoted segments from text, leaving the remainder
 */
export function removeQuotes(text: string): string {
  return text.replace(/"([^"]+)"/g, '').trim()
}

/**
 * Check if text contains any quotes
 */
export function hasQuotes(text: string): boolean {
  return /"([^"]+)"/g.test(text)
}

/**
 * For polls: Extract question from quotes (first quote) and options from remaining quotes
 * Returns { question: string | null, options: string[] | null }
 */
export function parsePollQuotes(text: string): { question: string | null; options: string[] | null } {
  const quotes = extractQuotes(text)
  if (quotes.length === 0) return { question: null, options: null }
  
  const question = quotes[0] || null
  const options = quotes.length > 1 ? quotes.slice(1) : null
  
  return { question, options }
}

/**
 * For announcements: Join all quotes with single space
 */
export function parseAnnouncementQuotes(text: string): string | null {
  const quotes = extractQuotes(text)
  if (quotes.length === 0) return null
  
  return quotes.join(' ')
}

