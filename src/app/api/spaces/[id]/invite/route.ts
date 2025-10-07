import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: spaceId } = await params
    if (!spaceId) {
      return NextResponse.json({ error: 'Space ID is required' }, { status: 400 })
    }

    const body = await request.json()
    const { email, name } = body

    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Check if space exists
    const { data: space, error: spaceError } = await supabase
      .from('space')
      .select('*')
      .eq('id', spaceId)
      .single()

    if (spaceError || !space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    // Check if user already exists in this specific space
    const { data: existingUserInSpace } = await supabase
      .from('app_user')
      .select('*')
      .eq('email', email.trim())
      .eq('space_id', spaceId)
      .maybeSingle()

    if (existingUserInSpace) {
      return NextResponse.json({ 
        error: 'User is already a member of this space',
        user: existingUserInSpace 
      }, { status: 409 })
    }

    // Check if user exists in any space (but not this one)
    const { data: existingUserAnywhere } = await supabase
      .from('app_user')
      .select('*')
      .eq('email', email.trim())
      .neq('space_id', spaceId)
      .maybeSingle()

    if (existingUserAnywhere) {
      // User exists in another space, add them to this space too
      const { data: newUser, error: userError } = await supabase
        .from('app_user')
        .insert({
          space_id: spaceId,
          email: email.trim(),
          name: name?.trim() || existingUserAnywhere.name || null,
          role: 'member'
        })
        .select()
        .single()

      if (userError) {
        console.error('User creation error:', userError)
        return NextResponse.json({ error: 'Failed to add user to this space' }, { status: 500 })
      }

      return NextResponse.json({ 
        success: true,
        user: newUser,
        message: `Added existing user ${email} to this space`
      })
    }

    // Create completely new user
    const { data: newUser, error: userError } = await supabase
      .from('app_user')
      .insert({
        space_id: spaceId,
        email: email.trim(),
        name: name?.trim() || null,
        role: 'member'
      })
      .select()
      .single()

    if (userError) {
      console.error('User creation error:', userError)
      return NextResponse.json({ error: 'Failed to invite user' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true,
      user: newUser,
      message: `Invitation sent to ${email}`
    })
  } catch (error) {
    console.error('Invite API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
