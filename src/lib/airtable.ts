export async function airtableInsert(
  baseId: string,
  tableName: string,
  fields: Record<string, any>
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.AIRTABLE_API_KEY
  if (!apiKey) return { ok: false, error: 'Missing AIRTABLE_API_KEY' }

  try {
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ records: [{ fields }] })
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || 'Airtable insert failed' }
    }
    const id = data?.records?.[0]?.id
    return { ok: true, id }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Airtable request failed' }
  }
}


