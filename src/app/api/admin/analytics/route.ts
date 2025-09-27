import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

export async function GET(_request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Queries in last 30 days
    const { data: queries } = await supabase
      .from('query_log')
      .select('id, text, results_count, satisfaction, created_at')
      .eq('space_id', DEFAULT_SPACE_ID)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    const total = queries?.length || 0
    const zeroHit = (queries || []).filter((q: any) => (q.results_count || 0) === 0).length
    const thumbsUp = (queries || []).filter((q: any) => q.satisfaction === 'thumbs_up').length
    const thumbsDown = (queries || []).filter((q: any) => q.satisfaction === 'thumbs_down').length

    // Top queries
    const freq: Record<string, number> = {}
    for (const q of queries || []) {
      const t = (q as any).text?.toLowerCase()?.trim()
      if (!t) continue
      freq[t] = (freq[t] || 0) + 1
    }
    const topQueries = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([text, count]) => ({ text, count }))

    return NextResponse.json({
      totals: { total, zeroHit, thumbsUp, thumbsDown },
      topQueries,
    })
  } catch (e) {
    console.error('Analytics error:', e)
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}


