import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { supabase, supabaseAdmin } from '@/lib/supabase'

// Get all spaces for the current user
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's email from Clerk
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    const userEmail = user.emailAddresses[0]?.emailAddress

    if (!userEmail) {
      return NextResponse.json({ error: 'User email not found' }, { status: 400 })
    }

    // Get all app_user entries for this email
    const dbClient = supabaseAdmin || supabase

    const { data: appUsers, error: appUsersError } = await dbClient
      .from('app_user')
      .select('space_id')
      .eq('email', userEmail)

    if (appUsersError) {
      console.error('App users fetch error:', appUsersError)
      return NextResponse.json({ error: 'Failed to fetch user spaces' }, { status: 500 })
    }

    // Get the space IDs this user is a member of
    const spaceIds = (appUsers || []).map((au: any) => au.space_id)

    // Always include the default space
    const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'
    if (!spaceIds.includes(DEFAULT_SPACE_ID)) {
      spaceIds.push(DEFAULT_SPACE_ID)
    }

    if (spaceIds.length === 0) {
      return NextResponse.json({ spaces: [] })
    }

    // Get spaces where user is a member
    const { data: spacesData, error } = await dbClient
      .from('space')
      .select('*')
      .in('id', spaceIds)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Spaces fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch spaces' }, { status: 500 })
    }

    let spaces = spacesData ?? []

    // Fallback: if user has no named spaces (just default), surface SEP spaces so uploads continue to work
    const hasNonDefaultSpace = (spaces || []).some(space => space.id !== DEFAULT_SPACE_ID)
    if (!hasNonDefaultSpace) {
      try {
        const { data: sepSpaces, error: sepError } = await dbClient
          .from('space')
          .select('*')
          .ilike('name', '%SEP%')
          .limit(10)

        if (!sepError && sepSpaces && sepSpaces.length > 0) {
          const sepOnly = sepSpaces.filter(space => space.id && !spaceIds.includes(space.id))
          if (sepOnly.length > 0) {
            spaces = [...spaces, ...sepOnly]
          }
        }
      } catch (sepErr) {
        console.error('SEP fallback fetch error:', sepErr)
      }
    }

    return NextResponse.json({ spaces })
  } catch (error) {
    console.error('Spaces API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Create a new space
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, domain } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Space name is required' }, { status: 400 })
    }

    // Get user's email from Clerk
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    const userEmail = user.emailAddresses[0]?.emailAddress
    const userName = user.firstName && user.lastName 
      ? `${user.firstName} ${user.lastName}`
      : (user.firstName || user.lastName || 'User')

    if (!userEmail) {
      return NextResponse.json({ error: 'User email not found' }, { status: 400 })
    }

    // Create the space
    const dbClient = supabaseAdmin || supabase

    const { data: space, error } = await dbClient
      .from('space')
      .insert({
        name: name.trim(),
        domain: domain?.trim() || null,
        default_visibility: 'space',
        created_by: userId  // Set the creator
      })
      .select()
      .single()

    if (error) {
      console.error('Space creation error:', error)
      return NextResponse.json({ error: 'Failed to create space' }, { status: 500 })
    }

    // CRITICAL: Add the creator as an admin member of the space
    // Use upsert to handle case where user already exists
    const { error: memberError } = await dbClient
      .from('app_user')
      .upsert({
        space_id: space.id,
        email: userEmail,
        user_id: userId,
        name: userName,
        role: 'admin'
      }, {
        onConflict: 'email,space_id',  // Handle duplicate email+space_id
        ignoreDuplicates: false  // Update existing record
      })

    if (memberError) {
      console.error('Failed to add creator as member:', memberError)
      // Don't fail the request, but log it
      // The space was created successfully, user can still access it via created_by
    } else {
      console.log(`Added creator ${userEmail} as admin of space ${space.id}`)
    }

    return NextResponse.json({ space })
  } catch (error) {
    console.error('Space creation API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
