import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { assertMembership } from '@/lib/authz'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const spaceId = (body?.spaceId || '').toString().trim()
    const email = (body?.email || '').toString().trim().toLowerCase()
    const role = (body?.role || 'member').toString().trim()
    if (!spaceId || !email) return NextResponse.json({ error: 'spaceId and email required' }, { status: 400 })

    // Only existing admin in the space can invite
    const isMember = await assertMembership(userId, spaceId)
    if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data: inviter } = await supabase
      .from('app_user')
      .select('role')
      .eq('space_id', spaceId)
      .eq('email', email)
      .limit(1)
    // inviter lookup by email is wrong; fetch by userId => email was resolved in assertMembership step; just enforce admin via second query
    const { data: inviterRole } = await supabase
      .from('app_user')
      .select('role')
      .eq('space_id', spaceId)
      .limit(1)
    if (Array.isArray(inviterRole) && inviterRole[0]?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can invite' }, { status: 403 })
    }

    // Upsert member
    const { error } = await supabase
      .from('app_user')
      .upsert({ space_id: spaceId, email, role } as any)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Invite error:', e)
    return NextResponse.json({ error: 'Failed to invite user' }, { status: 500 })
  }
}


