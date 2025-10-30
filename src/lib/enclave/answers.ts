import fs from 'fs'
import path from 'path'

function firstSentences(text: string, maxChars = 220, maxSentences = 2): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  let out = ''
  for (const s of sentences) {
    if ((out + (out ? ' ' : '') + s).length > maxChars) break
    out = out ? out + ' ' + s : s
    if (out.split(/(?<=[.!?])\s+/).length >= maxSentences) break
  }
  return out || text.slice(0, maxChars)
}

export async function enclaveConciseAnswer(userText: string): Promise<string> {
  try {
    const file = path.join(process.cwd(), 'docs', 'ENCLAVE_SYSTEM_REFERENCE.md')
    const content = fs.readFileSync(file, 'utf8')
    const lowerQ = (userText || '').toLowerCase()

    // Who made Enclave?
    if (/(who\s+made\s+enclave|who\s+built\s+enclave|founder|creator)/i.test(userText)) {
      const lines = content.split('\n')
      const dev = lines.find(l => l.toLowerCase().startsWith('primary developer')) || ''
      const team = lines.find(l => l.toLowerCase().startsWith('core team')) || ''
      const clean = `${dev.replace('Primary developer:','Primary developer:').trim()}${team ? `; ${team.replace('Core team:','Core team:').trim()}` : ''}`
      return clean || 'Primary developer: Saathvik Pai; Core team: The Inquiyr development team.'
    }

    // What does Enclave do / how does it work?
    if (/(what\s+does\s+enclave\s+do|how\s+do\w*\s+you\s+work|how\s+does\s+enclave\s+work|what\s+is\s+enclave)/i.test(userText)) {
      const lines = content.split('\n')
      const purpose = lines.find(l => l.startsWith('Purpose:')) || ''
      const func = lines.find(l => l.startsWith('High-level function:')) || ''
      const summary = `${purpose.replace('Purpose:','Purpose:').trim()} ${func.replace('High-level function:','').trim()}`
      return summary || 'Enclave unifies org comms/knowledge and lets you query/act via SMS (search, polls, announcements).'
    }

    // Default: concise first sentences from the doc
    return firstSentences(content, 220, 2)
  } catch {
    return 'Enclave unifies org communications/knowledge and lets you query/act via SMS (search, polls, announcements).'
  }
}


