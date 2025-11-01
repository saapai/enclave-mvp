export function resolveRelativeTime(phrase: string, now: Date = new Date()): { canonical?: string } {
  const lower = phrase.toLowerCase()
  const base = now.getTime()
  if (lower.includes('tomorrow')) return { canonical: new Date(base + 24 * 60 * 60 * 1000).toISOString() }
  if (lower.includes('yesterday')) return { canonical: new Date(base - 24 * 60 * 60 * 1000).toISOString() }
  return {}
}



