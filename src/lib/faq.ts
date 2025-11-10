import { supabaseAdmin } from './supabase'

interface EventInfo {
  name: string
  date?: string
  time?: string
  location?: string
  extra?: string
}

interface FaqEntry {
  answer?: string
  event?: EventInfo
  resourceTitle?: string
}

const CANONICAL_ALIASES: Record<string, FaqEntry> = {
  'when is big little': {
    event: {
      name: 'Big Little',
      date: 'November 13th',
      location: 'Family-specific ceremonies (Dark Knight, Crown Royale, Sauce, Nebula) followed by combined celebration',
      extra: 'Times are set by each family and announced closer to the date.'
    }
  },
  'what is big little': {
    event: {
      name: 'Big Little',
      extra: 'Family bonding tradition where Bigs welcome new Littles into Sigma Eta Pi families before a joint celebration.'
    }
  },
  'when is active meeting': {
    event: {
      name: 'Active Meeting',
      date: 'Every Wednesday',
      time: '8:00 PM',
      location: "Usually at Mahi's apartment (461B Kelton) or Ash's apartment (610 Levering)."
    }
  },
  'what is active meeting': {
    event: {
      name: 'Active Meeting',
      extra: 'Weekly chapter meeting for updates, planning, and coordination across professional and social tracks.'
    }
  },
  'when is ae summons': {
    event: {
      name: 'AE Summons',
      date: 'Date TBD',
      extra: 'Hosted by the Alpha Epsilon pledge class; similar format to AD/AG Summons—night of bonding and interactive challenges with older classes.'
    }
  },
  'what is ae summons': {
    event: {
      name: 'AE Summons',
      extra: 'Tradition where the Alpha Epsilon pledge class organizes a summons for the current pledges to build community and mentorship.'
    }
  },
  'when is big little appreciation': {
    event: {
      name: 'Big Little Appreciation',
      date: 'Wednesday, December 3rd',
      extra: 'Littles create personalized gifts (often decorated paddles) and performances to thank their Bigs.'
    }
  },
  'what is big little appreciation': {
    event: {
      name: 'Big Little Appreciation',
      extra: 'Celebration where Littles show gratitude to their Bigs with gifts and performances.'
    }
  }
}

const SYNONYM_MAP = new Map<string, string>([
  ['big little', 'big little'],
  ['bl', 'big little'],
  ['big/little', 'big little'],
  ['big little appreciation', 'big little appreciation'],
  ['bla', 'big little appreciation'],
  ['bl appreciation', 'big little appreciation'],
  ['active meeting', 'active meeting'],
  ['actives meeting', 'active meeting'],
  ['gm', 'active meeting'],
  ['general meeting', 'active meeting'],
  ['ae summons', 'ae summons'],
  ['ad/ag summons', 'ae summons']
])

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalize(text: string): string {
  const normalized = normalize(text)
  const canonical = SYNONYM_MAP.get(normalized)
  if (canonical) return canonical
 
  // try to map phrases that start with interrogatives
  const stripped = normalized
    .replace(/^(when|what|where|how)\s+(is|are|was|were)\s+/, '')
    .trim()
  return SYNONYM_MAP.get(stripped) || normalized
}

function formatEvent(event: EventInfo): string {
  const parts: string[] = []
  parts.push(`${event.name}${event.date ? ` is on ${event.date}` : ''}${event.time ? ` at ${event.time}` : ''}.`)
  if (event.location) parts.push(event.location)
  if (event.extra) parts.push(event.extra)
  return parts.join(' ')
}

export function resolveFaqAlias(rawQuery: string): FaqEntry | null {
  const normalized = normalize(rawQuery)
  const exact = CANONICAL_ALIASES[normalized]
  if (exact) {
    return exact
  }
  const canonicalKey = canonicalize(rawQuery)
  return CANONICAL_ALIASES[canonicalKey] || null
}

export async function fetchFaqAnswer(entry: FaqEntry): Promise<string | null> {
  if (entry.event) {
    return formatEvent(entry.event)
  }

  if (entry.answer) {
    return entry.answer
  }

  if (entry.resourceTitle) {
    try {
      const client = supabaseAdmin
      if (!client) return null
      const { data, error } = await client
        .from('resource')
        .select('body,title')
        .eq('title', entry.resourceTitle)
        .limit(1)

      if (error) {
        console.error('[FAQ] Failed to fetch resource for FAQ:', error.message)
        return null
      }

      const record = Array.isArray(data) ? data[0] : data
      if (!record) return null

      const body = record.body || ''
      return body ? body.slice(0, 600) : record.title || null
    } catch (err) {
      console.error('[FAQ] Error fetching FAQ resource:', err)
      return null
    }
  }

  return null
}
