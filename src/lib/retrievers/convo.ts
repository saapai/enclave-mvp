import { supabase } from '@/lib/supabase'

export type ConvoItem = {
  layer: 'convo'
  id: string
  snippet: string
  features: Record<string, number | string | boolean>
  score: number
}

export async function retrieveConvo(phoneDigits: string): Promise<ConvoItem[]> {
  const { data } = await supabase
    .from('sms_conversation_history')
    .select('user_message, bot_response, created_at')
    .eq('phone_number', phoneDigits)
    .order('created_at', { ascending: false })
    .limit(5)

  return (data || []).map((r, idx) => ({
    layer: 'convo',
    id: `convo-${idx}`,
    snippet: `User: ${r.user_message}\nBot: ${r.bot_response}`,
    features: { recency_ms: Date.now() - new Date(r.created_at as string).getTime() },
    score: Math.max(0, 1 - (Date.now() - new Date(r.created_at as string).getTime()) / (1000 * 60 * 60 * 24)),
  }))
}


