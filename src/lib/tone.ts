export type Tone = 'sassy_indo' | 'neutral'

export function applyTone(text: string, tone: Tone): string {
  if (tone === 'sassy_indo') {
    // Light-touch style: add a short tag line if not too long
    if (text.length < 160) {
      return `${text}\n\nhundred percent — it’s fine bro.`
    }
    return text
  }
  return text
}



