export type AbuseTargets = 'none' | 'self' | 'other' | 'protected'

const PROFANITY = /\b(fuck|shit|bitch|asshole|dick|wtf|damn)\b/i
const SLURS = /\b(retard(ed)?|fag(got)?|kike|chink|spic)\b/i

export function detectProfanity(text: string): boolean {
  return PROFANITY.test(text || '')
}

export function detectProtectedSlur(text: string): boolean {
  return SLURS.test(text || '')
}

export function guessInsultTarget(text: string): AbuseTargets {
  if (detectProtectedSlur(text)) return 'protected'
  if (/\byou\b/i.test(text)) return 'other'
  if (/\bi\b.*(suck|stupid|idiot)/i.test(text)) return 'self'
  return 'none'
}



