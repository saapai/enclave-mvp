import type { RetrievedItem as ContentItem } from '@/lib/retrievers/content'
import type { ConvoItem } from '@/lib/retrievers/convo'
import type { EnclaveItem } from '@/lib/retrievers/enclave'
import type { ActionItem } from '@/lib/retrievers/action'

export type Decision =
  | { type: 'clarify'; message: string; confidence: number }
  | { type: 'answer'; message: string; confidence: number; sources?: Array<{ layer: string; title?: string }> }
  | { type: 'execute_action'; action: any; confidence: number }

export function combine(
  params: {
    intent: string
    content: ContentItem[]
    convo: ConvoItem[]
    enclave: EnclaveItem[]
    action: ActionItem[]
  }
): Decision {
  const { intent, content, enclave, action } = params

  // Simple confidence calibration
  const contentTop = content[0]?.score || 0
  const enclaveTop = enclave[0]?.score || 0
  const agreementBoost = contentTop > 0.6 && enclaveTop > 0.4 ? 0.15 : 0
  let score = Math.max(contentTop, enclaveTop) + agreementBoost
  score = Math.max(0, Math.min(1, score))

  // Action proposals
  if (intent === 'action_request' && action.length > 0) {
    return { type: 'execute_action', action: action[0].proposal, confidence: 0.7 }
  }

  if (intent === 'enclave_help' && enclave.length > 0) {
    const message = enclave[0].snippet
    const sources = [{ layer: 'enclave', title: enclave[0].title }]
    if (score < 0.35) return { type: 'clarify', message: 'hundred percent — what about Enclave do you wanna know?', confidence: score }
    if (score < 0.65) return { type: 'answer', message, confidence: score, sources }
    return { type: 'answer', message, confidence: score, sources }
  }

  if (intent === 'content_query') {
    if (!content.length) return { type: 'clarify', message: "couldn't find that in your org docs — be specific, bro", confidence: 0.2 }
    const merged = content.slice(0, 1)
    const message = merged[0].snippet
    const sources = merged.map(m => ({ layer: m.layer, title: m.title }))
    if (score < 0.35) return { type: 'clarify', message: 'say less — what exactly do you need?', confidence: score }
    if (score < 0.65) return { type: 'answer', message, confidence: score, sources }
    return { type: 'answer', message, confidence: score, sources }
  }

  if (intent === 'smalltalk') {
    return { type: 'answer', message: "it’s fine bro — ask me about events or docs. that’s lit.", confidence: 0.5 }
  }

  if (intent === 'abusive') {
    return { type: 'answer', message: "come on bro — i’m here to help. try 'when is study hall'", confidence: 0.4 }
  }

  return { type: 'clarify', message: 'what do you need exactly?', confidence: 0.3 }
}



