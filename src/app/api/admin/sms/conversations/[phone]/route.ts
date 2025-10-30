import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function normalizeInputs(phoneParam: string): { digits: string; e164: string; variants: string[] } {
  const digits = String(phoneParam).replace(/[^\d]/g, '').slice(-10)
  const e164 = digits ? `+1${digits}` : phoneParam
  const variants = Array.from(new Set([e164, digits]))
  return { digits, e164, variants }
}

export async function GET(_request: NextRequest, { params }: { params: { phone: string } }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { digits, e164, variants } = normalizeInputs(params.phone)

    // Load name and opt-out
    const { data: optin } = await supabase
      .from('sms_optin')
      .select('name, opted_out')
      .eq('phone', digits)
      .maybeSingle()

    // Load Q&A pairs (user and bot) from conversation history
    const { data: history } = await supabase
      .from('sms_conversation_history')
      .select('user_message, bot_response, created_at')
      .eq('phone_number', digits)
      .order('created_at', { ascending: true })

    // Load outbound messages from message log
    const { data: log } = await supabase
      .from('sms_message_log')
      .select('message, status, twilio_sid, sent_at, created_at, phone')
      .in('phone', variants)
      .order('created_at', { ascending: true })

    type Item = {
      id: string
      at: string
      direction: 'inbound' | 'outbound'
      kind: 'query' | 'bot_reply' | 'blast'
      body: string
      status?: string | null
      sid?: string | null
    }

    const items: Item[] = []

    for (const row of history || []) {
      const t = row.created_at as string
      // Inbound user query
      items.push({
        id: `in-${t}`,
        at: t,
        direction: 'inbound',
        kind: 'query',
        body: row.user_message as string
      })
      // Outbound bot response (same timestamp ordering will keep pair contiguous)
      items.push({
        id: `out-${t}`,
        at: t,
        direction: 'outbound',
        kind: 'bot_reply',
        body: row.bot_response as string
      })
    }

    for (const row of log || []) {
      const t = (row.sent_at as string) || (row.created_at as string)
      items.push({
        id: `blast-${row.twilio_sid || t}`,
        at: t,
        direction: 'outbound',
        kind: 'blast',
        body: row.message as string,
        status: (row.status as string) || null,
        sid: (row.twilio_sid as string) || null
      })
    }

    items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

    return NextResponse.json({
      phone: e164,
      name: optin?.name || null,
      optedOut: !!optin?.opted_out,
      items
    })
  } catch (e) {
    console.error('[Conversation Thread API] Error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


