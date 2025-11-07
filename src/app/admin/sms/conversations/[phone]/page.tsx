'use client'

import React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

type ThreadResponse = {
  phone: string
  name: string | null
  optedOut: boolean
  items: Array<{
    id: string
    at: string
    direction: 'inbound' | 'outbound'
    kind: 'query' | 'bot_reply' | 'blast'
    body: string
    status?: string | null
    sid?: string | null
  }>
}

export default function ConversationThreadPage() {
  const params = useParams<{ phone: string }>()
  const phoneParam = params.phone
  const [data, setData] = React.useState<ThreadResponse | null>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/sms/conversations/${encodeURIComponent(phoneParam)}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }, [phoneParam])

  React.useEffect(() => {
    load()
  }, [load])

  // Auto-refresh every 5s
  React.useEffect(() => {
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-500">
            <Link href="/admin/sms/conversations" className="hover:underline">Conversations</Link> / Thread
          </div>
          <h1 className="text-xl font-semibold">
            {data?.name ? `${data.name} ` : ''}
            <span className="text-gray-500">{data?.phone || phoneParam}</span>
          </h1>
        </div>
        {data?.optedOut && (
          <span className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700">opted out</span>
        )}
      </div>

      {loading && (
        <div className="mb-4 text-sm text-gray-500">Loading…</div>
      )}

      <div className="space-y-4">
        {data?.items?.map((m) => (
          <div key={m.id} className="rounded border p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <span className={`rounded px-2 py-0.5 ${m.direction === 'inbound' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                  {m.direction === 'inbound' ? 'user' : 'bot'}
                </span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">{m.kind}</span>
              </div>
              <div className="text-xs text-gray-500">{new Date(m.at).toLocaleString()}</div>
            </div>
            <pre className="whitespace-pre-wrap break-words text-sm">{m.body}</pre>
            {m.status && (
              <div className="mt-2 text-xs text-gray-500">status: {m.status}{m.sid ? ` • ${m.sid}` : ''}</div>
            )}
          </div>
        ))}

        {!loading && (!data?.items || data.items.length === 0) && (
          <div className="text-center text-sm text-gray-500">No messages yet.</div>
        )}
      </div>
    </div>
  )
}





