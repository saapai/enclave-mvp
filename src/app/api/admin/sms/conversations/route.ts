import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim().toLowerCase()
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)

    // Base: all known phones from sms_optin
    const { data: optins, error: optErr } = await supabase
      .from('sms_optin')
      .select('phone, name, opted_out, updated_at, consent_timestamp')

    if (optErr) return NextResponse.json({ error: 'Failed to load opt-ins' }, { status: 500 })

    const phones = Array.from(new Set((optins || []).map(o => String(o.phone))))

    // Latest activity from conversation history
    const { data: histRows } = await supabase
      .from('sms_conversation_history')
      .select('phone_number, created_at')
      .in('phone_number', phones.map(p => p.replace(/^[+]/, '').replace(/^1/, '').replace(/[^\d]/g, '').slice(-10)))

    // Latest activity from message log
    const { data: logRows } = await supabase
      .from('sms_message_log')
      .select('phone, sent_at, created_at, status')
      .in('phone', [
        ...phones,
        ...phones.map(p => {
          const digits = String(p).replace(/[^\d]/g, '').slice(-10)
          return digits ? `+1${digits}` : p
        })
      ])

    const phoneToLatest: Record<string, string> = {}
    const phoneToStats: Record<string, { sent?: number; failed?: number }> = {}

    const setLatest = (phoneKey: string, ts?: string | null) => {
      if (!ts) return
      const prev = phoneToLatest[phoneKey]
      if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) {
        phoneToLatest[phoneKey] = ts
      }
    }

    for (const row of histRows || []) {
      const digits = String(row.phone_number).replace(/[^\d]/g, '').slice(-10)
      const e164 = digits ? `+1${digits}` : String(row.phone_number)
      setLatest(e164, row.created_at)
    }

    for (const row of logRows || []) {
      const phone = String(row.phone)
      setLatest(phone, row.sent_at || row.created_at)
      const stats = phoneToStats[phone] || {}
      if (row.status === 'failed') stats.failed = (stats.failed || 0) + 1
      if (row.status === 'sent' || row.status === 'queued' || row.status === 'delivered') stats.sent = (stats.sent || 0) + 1
      phoneToStats[phone] = stats
    }

    const rows = (optins || []).map(o => {
      const digits = String(o.phone).replace(/[^\d]/g, '').slice(-10)
      const e164 = digits ? `+1${digits}` : String(o.phone)
      const latest = phoneToLatest[e164] || o.updated_at || o.consent_timestamp
      const stats = phoneToStats[e164] || {}
      return {
        phone: e164,
        name: o.name || null,
        optedOut: !!o.opted_out,
        latestActivityAt: latest || null,
        sentCount: stats.sent || 0,
        failedCount: stats.failed || 0
      }
    })

    const filtered = q
      ? rows.filter(r => r.phone.includes(q) || (r.name || '').toLowerCase().includes(q))
      : rows

    filtered.sort((a, b) => {
      const at = a.latestActivityAt ? new Date(a.latestActivityAt).getTime() : 0
      const bt = b.latestActivityAt ? new Date(b.latestActivityAt).getTime() : 0
      return bt - at
    })

    const paged = filtered.slice(offset, offset + limit)

    return NextResponse.json({ total: filtered.length, items: paged })
  } catch (e) {
    console.error('[Conversations API] Error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


