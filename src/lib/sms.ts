export async function sendSms(
  to: string, 
  body: string,
  options?: { retries?: number; retryDelay?: number }
): Promise<{ sid?: string; ok: boolean; error?: string; deliveryError?: boolean }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !fromNumber) {
    return { ok: false, error: 'Twilio environment variables are not configured' }
  }

  const maxRetries = options?.retries ?? 0
  const retryDelay = options?.retryDelay ?? 1000

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
        let errorData: any = {}
        try {
          errorData = JSON.parse(text)
        } catch {
          // Not JSON, use text as-is
        }

        // Check for specific error codes
        const errorCode = errorData.code || errorData.error_code
        const errorMessage = errorData.message || text

        // Error 30003 is a delivery error that happens asynchronously
        // If we get it here, it means the API rejected it (rare)
        // Most 30003 errors come via webhooks after message is accepted
        if (errorCode === 30003) {
          console.warn(`[SMS] Twilio delivery error 30003 for ${to}: ${errorMessage}`)
          // Still return ok: true with a warning, since delivery errors happen async
          return { ok: true, error: `Delivery may fail: ${errorMessage}`, deliveryError: true }
        }

        // Retry on transient errors (5xx, rate limits)
        if (attempt < maxRetries && (res.status >= 500 || errorCode === 20429)) {
          console.log(`[SMS] Retrying send to ${to} (attempt ${attempt + 1}/${maxRetries + 1})`)
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)))
          continue
        }

        return { ok: false, error: `Twilio error ${errorCode || res.status}: ${errorMessage}` }
      }

      const data = await res.json()
      
      // Success - message accepted by Twilio
      // Note: Delivery errors (like 30003) will come via webhooks asynchronously
      return { ok: true, sid: data.sid }
    } catch (e: any) {
      // Retry on network errors
      if (attempt < maxRetries) {
        console.log(`[SMS] Network error, retrying send to ${to} (attempt ${attempt + 1}/${maxRetries + 1})`)
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)))
        continue
      }
      return { ok: false, error: e?.message || 'Failed to send SMS' }
    }
  }

  return { ok: false, error: 'Max retries exceeded' }
}

export function normalizeE164(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}


