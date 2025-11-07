export type ToneDecision = { tone: 'neutral' | 'sass' | 'spicy'; policy: 'ok' | 'boundary'; prefix?: string; suffix?: string }

type ToneSignals = {
  smalltalk: number
  toxicity: number
  hasQuery: boolean
  insultTargets: 'none' | 'self' | 'other' | 'protected'
  contextEdge?: number
}

const SPICY = [
  'Alright tough guy —',
  'Say less, hotshot —',
  'Relax, gladiator. Here’s the gist:',
  'Bold mouth, tight answer:'
]
const SASS = [
  'Ok sass-master:',
  'Heard. Quick hits:',
  'Cool cool. TL;DR:',
  'Big talk. Short answer:'
]
const NEUTRAL = [
  'Here you go:',
  'Quick answer:',
  'TL;DR:',
  'In short:'
]

function pick(arr: string[]) { return arr[Math.floor(Math.random() * arr.length)] }

export function decideTone(sig: ToneSignals): ToneDecision {
  if (sig.insultTargets === 'protected') {
    return { tone: 'neutral', policy: 'boundary', prefix: '✋ Keep it respectful. ', suffix: '' }
  }
  const A = Math.max(0, Math.min(1, 0.5 * sig.toxicity + 0.3 * sig.smalltalk + 0.2 * (sig.contextEdge ?? 0)))
  if (A >= 0.65) return { tone: 'spicy', policy: 'ok', prefix: pick(SPICY) + ' ', suffix: '' }
  if (A >= 0.35) return { tone: 'sass', policy: 'ok', prefix: pick(SASS) + ' ', suffix: '' }
  return { tone: 'neutral', policy: 'ok', prefix: pick(NEUTRAL) + ' ', suffix: '' }
}





