import { supabase } from '@/lib/supabase'

export type ActionProposal = {
  kind: 'record_vote' | 'schedule_announcement' | 'resend_failed' | 'show_optin'
  preview_text: string
  preconditions: { consent?: boolean; role?: 'admin' | 'member'; tps_ok?: boolean; quiet_hours_ok?: boolean }
  payload: Record<string, any>
}

export type ActionItem = {
  layer: 'action'
  id: string
  snippet: string
  features: Record<string, number | string | boolean>
  score: number
  proposal?: ActionProposal
}

export async function retrieveAction(phoneE164: string): Promise<ActionItem[]> {
  const items: ActionItem[] = []

  // Pending poll response
  const { data: pending } = await supabase
    .from('sms_poll_response')
    .select('sms_poll!inner(id, question, options, sent_at)')
    .eq('phone', phoneE164)
    .eq('response_status', 'pending')
    .limit(1)
    .maybeSingle()

  if (pending?.sms_poll?.id) {
    items.push({
      layer: 'action',
      id: `poll-${pending.sms_poll.id}`,
      snippet: `Pending poll: ${pending.sms_poll.question}`,
      features: { pending_poll: true },
      score: 0.8,
      proposal: {
        kind: 'record_vote',
        preview_text: 'Record poll vote',
        preconditions: {},
        payload: { pollId: pending.sms_poll.id },
      },
    })
  }

  return items
}



