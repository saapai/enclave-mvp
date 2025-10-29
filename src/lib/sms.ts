export async function sendSms(to: string, body: string): Promise<{ sid?: string; ok: boolean; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !fromNumber) {
    return { ok: false, error: 'Twilio environment variables are not configured' }
  }

  try {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const form = new URLSearchParams()
    form.set('From', fromNumber)
    form.set('To', to)
    form.set('Body', body)

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    })

    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `Twilio error: ${text}` }
    }
    const data = await res.json()
    return { ok: true, sid: data.sid }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to send SMS' }
  }
}

export function normalizeE164(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}


