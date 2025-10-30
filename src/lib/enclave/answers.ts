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
    const tldr = firstSentences(content, 220, 2)
    return `${tldr}\n— reply 'more' for details • 'help' for commands`
  } catch {
    return `Enclave helps your org query docs, events, and send SMS polls/announcements.\n— reply 'more' for details • 'help' for commands`
  }
}


