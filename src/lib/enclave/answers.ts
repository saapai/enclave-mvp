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

    // Who made Enclave/Jarvis?
    if (/(who\s+made\s+(enclave|jarvis)|who\s+built\s+(enclave|jarvis)|who\s+created\s+(enclave|jarvis)|who\s+is\s+(enclave|jarvis)|founder|creator)/i.test(userText)) {
      const lines = content.split('\n')
      const dev = lines.find(l => l.toLowerCase().includes('primary developer')) || ''
      const team = lines.find(l => l.toLowerCase().includes('core team')) || ''
      const isJarvisQuery = /jarvis/i.test(userText)
      if (isJarvisQuery) {
        // For Jarvis questions, clarify that Jarvis is the bot powered by Enclave
        return 'Jarvis is the AI assistant that powers Enclave — built by Saathvik Pai and the Inquiyr development team. I can search your org\'s docs, events, and send polls/announcements via SMS.'
      }
      const clean = `${dev.replace(/Primary developer:\s*/i,'').trim()}${team ? `; ${team.replace(/Core team:\s*/i,'').trim()}` : ''}`
      return clean || 'Primary developer: Saathvik Pai; Core team: The Inquiyr development team.'
    }

    // What does Enclave/Jarvis do / how does it work?
    if (/(what\s+does\s+(enclave|jarvis)\s+do|how\s+do\w*\s+you\s+work|how\s+does\s+(enclave|jarvis)\s+work|what\s+is\s+(enclave|jarvis))/i.test(userText)) {
      const lines = content.split('\n')
      const purpose = lines.find(l => l.startsWith('Purpose:')) || ''
      const func = lines.find(l => l.startsWith('High-level function:')) || ''
      const isJarvisQuery = /jarvis/i.test(userText)
      if (isJarvisQuery) {
        // For Jarvis questions, explain that Jarvis is the bot powered by Enclave
        return 'I\'m Jarvis, the AI assistant powered by Enclave. I unify your org\'s communications/knowledge and let you query/act via SMS — search docs/events, send polls/announcements.'
      }
      const summary = `${purpose.replace('Purpose:','Purpose:').trim()} ${func.replace('High-level function:','').trim()}`
      return summary || 'Enclave unifies org comms/knowledge and lets you query/act via SMS (search, polls, announcements).'
    }

    // Default: concise first sentences from the doc
    return firstSentences(content, 220, 2)
  } catch {
    return 'Enclave unifies org communications/knowledge and lets you query/act via SMS (search, polls, announcements). Jarvis is the AI assistant that powers Enclave.'
  }
}


