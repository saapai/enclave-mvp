import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getUserEmail } from '@/lib/authz'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const name = (body?.name || '').toString().trim()
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    const email = await getUserEmail(userId)
    if (!email) return NextResponse.json({ error: 'User email not found' }, { status: 400 })

    // Create space
    const { data: space, error: spaceErr } = await supabase
      .from('space')
      .insert({ name })
      .select()
      .single()
    if (spaceErr) throw spaceErr

    // Add creator as admin member
    await supabase
      .from('app_user')
      .insert({ space_id: (space as any).id, email, role: 'admin' } as any)

    return NextResponse.json({ space })
  } catch (e) {
    console.error('Create space error:', e)
    return NextResponse.json({ error: 'Failed to create space' }, { status: 500 })
  }
}


