'use client'

import React from 'react'
import Link from 'next/link'

type ConversationRow = {
  phone: string
  name: string | null
  optedOut: boolean
  latestActivityAt: string | null
  sentCount: number
  failedCount: number
}

export default function ConversationsPage() {
  const [q, setQ] = React.useState('')
  const [rows, setRows] = React.useState<ConversationRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/sms/conversations?q=${encodeURIComponent(q)}&limit=200`)
    const data = await res.json()
    setRows(data.items || [])
    setTotal(data.total || 0)
    setLoading(false)
  }, [q])

  React.useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">SMS Conversations</h1>
        <span className="text-sm text-gray-500">{loading ? 'Loading…' : `${total} total`}</span>
      </div>
      <div className="mb-6 flex gap-2">
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Search by name or phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load()
          }}
        />
        <button
          className="rounded bg-black px-4 py-2 text-white"
          onClick={load}
        >
          Search
        </button>
      </div>

      <div className="divide-y rounded border">
        {rows.map((r) => (
          <Link key={r.phone} href={`/admin/sms/conversations/${encodeURIComponent(r.phone)}`} className="block hover:bg-gray-50">
            <div className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">
                  {r.name ? `${r.name} ` : ''}
                  <span className="text-gray-500">{r.phone}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {r.latestActivityAt ? new Date(r.latestActivityAt).toLocaleString() : 'No activity yet'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {r.optedOut && (
                  <span className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700">opted out</span>
                )}
                <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-700">sent {r.sentCount}</span>
                {r.failedCount > 0 && (
                  <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">failed {r.failedCount}</span>
                )}
              </div>
            </div>
          </Link>
        ))}
        {!loading && rows.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">No conversations found.</div>
        )}
      </div>
    </div>
  )
}


