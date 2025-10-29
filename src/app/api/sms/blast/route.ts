import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase, supabaseAdmin } from '@/lib/supabase'
import { sendSms, normalizeE164 } from '@/lib/sms'

function makeCode(): string {
  // 4-char base36 code
  return Math.random().toString(36).slice(2, 6).toUpperCase()
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { spaceId, type, message, options, airtableBaseId, airtableTable } = body || {}

    if (!spaceId || !type || !message) {
      return NextResponse.json({ error: 'spaceId, type, and message are required' }, { status: 400 })
    }
    if (!['announcement', 'poll'].includes(type)) {
      return NextResponse.json({ error: 'type must be announcement or poll' }, { status: 400 })
    }
    if (type === 'poll') {
      if (!Array.isArray(options) || options.length < 2 || options.length > 9) {
        return NextResponse.json({ error: 'poll requires 2-9 options' }, { status: 400 })
      }
    }

    // Verify requester is a member of the space
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const clerkUser = await client.users.getUser(userId)
    const userEmail = clerkUser.emailAddresses[0]?.emailAddress
    const { data: membership } = await supabase
      .from('app_user')
      .select('space_id, role')
      .eq('email', userEmail)
      .eq('space_id', spaceId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Fetch recipients: app_user with phone, opted in via sms_optin
    const { data: members } = await supabase
      .from('app_user')
      .select('name, phone')
      .eq('space_id', spaceId)

    const phones = (members || [])
      .map(m => m.phone)
      .filter(Boolean)
      .map(p => normalizeE164(String(p)))

    const uniquePhones = Array.from(new Set(phones))
    if (uniquePhones.length === 0) {
      return NextResponse.json({ error: 'No recipients with phone numbers in this space' }, { status: 400 })
    }

    const { data: optins } = await supabase
      .from('sms_optin')
      .select('phone, opted_out')
      .in('phone', uniquePhones)

    // Send to all registered phones in the space, except those who have explicitly opted out
    const optedOutSet = new Set((optins || []).filter(o => o.opted_out).map(o => o.phone))
    const recipients = uniquePhones.filter(p => !optedOutSet.has(p))
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No eligible recipients (all opted out) in this space' }, { status: 400 })
    }

    const dbClient = supabaseAdmin || supabase

    let pollId: string | null = null
    let code: string | null = null
    let finalMessage = message

    if (type === 'poll') {
      // Create poll with short code
      code = makeCode()
      const { data: created, error: pollErr } = await dbClient
        .from('sms_poll')
        .insert({
          space_id: spaceId,
          question: message,
          options: options,
          code,
          created_by: userId
        } as any)
        .select('id, code')
        .single()
      if (pollErr || !created?.id) {
        return NextResponse.json({ error: 'Failed to create poll' }, { status: 500 })
      }
      pollId = created.id as string

      // Build poll instructions with numeric mapping 1..n
      const lines: string[] = []
      ;(options as string[]).forEach((opt: string, idx: number) => {
        lines.push(`${idx + 1}) ${opt}`)
      })
      const rawResultsUrl = process.env.AIRTABLE_PUBLIC_RESULTS_URL
      const sanitizedResultsUrl = rawResultsUrl?.replace(/^@+/, '')
      const publicResultsUrl =
        sanitizedResultsUrl ||
        (process.env.AIRTABLE_BASE_ID ? `https://airtable.com/${process.env.AIRTABLE_BASE_ID}` : undefined)
      const resultsSuffix = publicResultsUrl ? `\nView results: ${publicResultsUrl} (search code ${code})` : ''
      finalMessage = `POLL (${code}): ${message}\nReply with number or option word:\n${lines.join('\n')}${resultsSuffix}`
    }

    // Send messages
    const results: Array<{ to: string; ok: boolean; error?: string }> = []
    for (const to of recipients) {
      const res = await sendSms(to, finalMessage)
      results.push({ to, ok: res.ok, error: res.error })
      // Log to sms_message_log
      await dbClient.from('sms_message_log').insert({
        phone: to,
        message: finalMessage,
        status: res.ok ? 'queued' : 'failed',
        twilio_sid: res.sid || null,
      } as any)
      // Seed poll recipients (optional)
      if (type === 'poll' && pollId) {
        await dbClient.from('sms_poll_response').insert({
          poll_id: pollId,
          phone: to,
          option_index: 0,
          option_label: '',
        } as any).onConflict('poll_id,phone').ignore()
      }
    }

    const responsePayload: any = {
      success: true,
      type,
      recipients: results,
      pollId,
      code
    }
    if (type === 'poll') {
      responsePayload.resultsUrl = process.env.AIRTABLE_PUBLIC_RESULTS_URL || (process.env.AIRTABLE_BASE_ID ? `https://airtable.com/${process.env.AIRTABLE_BASE_ID}` : undefined)
    }
    return NextResponse.json(responsePayload)
  } catch (e) {
    console.error('SMS blast error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


