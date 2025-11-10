import { supabaseAdmin } from './supabase'

interface FaqEntry {
  answer?: string
  resourceTitle?: string
}

const FAQ_ALIASES: Record<string, FaqEntry> = {
  'when is big little': {
    answer: 'Big Little is on November 13th. Time and location are still TBD, with each family hosting its own ceremony before the combined celebration.'
  },
  'when is active meeting': {
    answer: 'Active meeting happens every Wednesday at 8:00 PM, usually at Mahi\'s apartment (461B Kelton) or Ash\'s apartment (610 Levering).' 
  },
  'when is ae summons': {
    answer: 'AE Summons is hosted by the Alpha Epsilon pledge class. The exact date is TBD, but the format is similar to AD/AG Summons: a night of interactive bonding and challenges with the older classes.'
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
}

export function resolveFaqAlias(rawQuery: string): FaqEntry | null {
  const normalized = normalize(rawQuery)
  return FAQ_ALIASES[normalized] || null
}

export async function fetchFaqAnswer(entry: FaqEntry): Promise<string | null> {
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
