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

    // Normalize phone number helper (same as SMS route: remove +1 prefix, keep 10 digits)
    const normalizePhone = (phone: string): string => {
      const cleaned = String(phone).replace(/[^\d]/g, '')
      // Remove leading +1 if present
      if (cleaned.startsWith('1') && cleaned.length === 11) {
        return cleaned.substring(1)
      }
      // Return last 10 digits
      return cleaned.slice(-10)
    }
    
    // Convert normalized phone to E.164 format
    const toE164 = (normalized: string): string => {
      if (normalized.length === 10) {
        return `+1${normalized}`
      }
      return normalized
    }

    // Get ALL conversation history (not just for phones in optin)
    // This ensures we show all conversations even if phone isn't in optin table
    const { data: histRows, error: histErr } = await supabase
      .from('sms_conversation_history')
      .select('phone_number, created_at')
      .order('created_at', { ascending: false })

    if (histErr) {
      console.error('[Conversations API] Error loading history:', histErr)
      return NextResponse.json({ error: 'Failed to load conversation history' }, { status: 500 })
    }

    // Get ALL phones from optin
    const { data: optins, error: optErr } = await supabase
      .from('sms_optin')
      .select('phone, name, opted_out, updated_at, consent_timestamp')

    if (optErr) {
      console.error('[Conversations API] Error loading optins:', optErr)
      return NextResponse.json({ error: 'Failed to load opt-ins' }, { status: 500 })
    }

    // Get ALL message log entries
    const { data: logRows } = await supabase
      .from('sms_message_log')
      .select('phone, sent_at, created_at, status')
      .order('created_at', { ascending: false })

    const phoneToLatest: Record<string, string> = {}
    const phoneToStats: Record<string, { sent?: number; failed?: number }> = {}
    const phoneToOptin: Record<string, { phone: string; name: string | null; opted_out: boolean; updated_at: string | null; consent_timestamp: string | null }> = {}
    const allPhones = new Set<string>()

    const setLatest = (phoneKey: string, ts?: string | null) => {
      if (!ts) return
      const prev = phoneToLatest[phoneKey]
      if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) {
        phoneToLatest[phoneKey] = ts
      }
    }

    // Process conversation history - normalize and track all phones
    for (const row of histRows || []) {
      const normalized = normalizePhone(row.phone_number)
      const e164 = toE164(normalized)
      allPhones.add(e164)
      setLatest(e164, row.created_at)
    }

    // Process message log - normalize and track all phones
    for (const row of logRows || []) {
      const normalized = normalizePhone(row.phone)
      const e164 = toE164(normalized)
      allPhones.add(e164)
      setLatest(e164, row.sent_at || row.created_at)
      const stats = phoneToStats[e164] || {}
      if (row.status === 'failed') stats.failed = (stats.failed || 0) + 1
      if (row.status === 'sent' || row.status === 'queued' || row.status === 'delivered') stats.sent = (stats.sent || 0) + 1
      phoneToStats[e164] = stats
    }

    // Build optin map for quick lookup
    for (const optin of optins || []) {
      const normalized = normalizePhone(optin.phone)
      const e164 = toE164(normalized)
      phoneToOptin[e164] = optin
      allPhones.add(e164)
    }

    // Build rows from ALL phones (not just optin)
    const rows = Array.from(allPhones).map(phone => {
      const normalized = normalizePhone(phone)
      const e164 = toE164(normalized)
      const optin = phoneToOptin[e164]
      const latest = phoneToLatest[e164] || optin?.updated_at || optin?.consent_timestamp
      const stats = phoneToStats[e164] || {}
      return {
        phone: e164,
        name: optin?.name || null,
        optedOut: !!optin?.opted_out,
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



