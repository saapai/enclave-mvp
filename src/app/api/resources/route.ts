import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      title,
      description,
      type,
      url,
      tags = [],
      startAt,
      endAt,
      location,
      rsvpLink,
      cost,
      dressCode
    } = body

    if (!title || !type) {
      return NextResponse.json(
        { error: 'Title and type are required' },
        { status: 400 }
      )
    }

    // Create the resource
    const { data: resource, error: resourceError } = await supabase
      .from('resource')
      .insert({
        space_id: '00000000-0000-0000-0000-000000000000', // Default space for MVP
        type,
        title: title.trim(),
        body: description?.trim() || null,
        url: url?.trim() || null,
        source: 'upload',
        visibility: 'space',
        created_by: userId
      } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .select()
      .single()

    if (resourceError) {
      throw resourceError
    }

    // Create tags if they don't exist and link them to the resource
    if (tags.length > 0) {
      for (const tagName of tags) {
        // Check if tag exists
        const { data: existingTag } = await supabase
          .from('tag')
          .select('id')
          .eq('space_id', '00000000-0000-0000-0000-000000000000')
          .eq('name', tagName)
          .single()

        let tagId = (existingTag as any)?.id // eslint-disable-line @typescript-eslint/no-explicit-any

        // Create tag if it doesn't exist
        if (!tagId) {
          const { data: newTag, error: tagError } = await supabase
            .from('tag')
            .insert({
              space_id: '00000000-0000-0000-0000-000000000000',
              name: tagName,
              kind: 'topic' // Default kind for user-created tags
            } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            .select()
            .single()

          if (tagError) {
            console.error('Tag creation error:', tagError)
            continue
          }
          tagId = (newTag as any)?.id // eslint-disable-line @typescript-eslint/no-explicit-any
        }

        // Link tag to resource
        await supabase
          .from('resource_tag')
          .insert({
            resource_id: (resource as any)?.id, // eslint-disable-line @typescript-eslint/no-explicit-any
            tag_id: tagId
          } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    }

    // Create event metadata if it's an event
    if (type === 'event' && (startAt || endAt || location || rsvpLink || cost || dressCode)) {
      await supabase
        .from('event_meta')
        .insert({
          resource_id: (resource as any)?.id, // eslint-disable-line @typescript-eslint/no-explicit-any
          start_at: startAt || null,
          end_at: endAt || null,
          location: location || null,
          rsvp_link: rsvpLink || null,
          cost: cost || null,
          dress_code: dressCode || null
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    return NextResponse.json({ resource })
  } catch (error) {
    console.error('Resource creation error:', error)
    return NextResponse.json(
      { error: 'Failed to create resource' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const { data: resources, error } = await supabase
      .from('resource')
      .select(`
        *,
        tags:resource_tag(
          tag:tag(*)
        ),
        event_meta(*),
        created_by_user:app_user(*)
      `)
      .eq('space_id', '00000000-0000-0000-0000-000000000000')
      .order('updated_at', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    // Transform the data
    const transformedResources = (resources || []).map((resource: Record<string, unknown>) => ({
      ...resource,
      tags: (resource.tags as Array<{ tag: Record<string, unknown> }>)?.map((rt) => rt.tag).filter(Boolean) || []
    }))

    return NextResponse.json({ resources: transformedResources })
  } catch (error) {
    console.error('Resources fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch resources' },
      { status: 500 }
    )
  }
}
