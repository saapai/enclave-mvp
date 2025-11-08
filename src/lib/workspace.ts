/**
 * Workspace utilities
 */

import { supabase, supabaseAdmin } from '@/lib/supabase'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

interface WorkspaceOptions {
  phoneNumber?: string
  includeSepFallback?: boolean
  includePhoneLookup?: boolean
}

type AppUserRow = {
  space_id: string | null
  phone: string | null
}

type SpaceRow = {
  id: string | null
  name: string | null
}

function normalizeDigits(phone: string): string {
  return phone.replace(/[^\d]/g, '').slice(-10)
}

/**
 * Resolve workspace IDs for a given context (phone, SEP fallback, etc.)
 */
export async function getWorkspaceIds(options: WorkspaceOptions = {}): Promise<string[]> {
  console.log('[Workspace] getWorkspaceIds called with options:', options)
  const client = supabaseAdmin || supabase

  if (!client) {
    console.error('[Workspace] No Supabase client available')
    return [DEFAULT_SPACE_ID]
  }

  const resolved = new Set<string>()
  resolved.add(DEFAULT_SPACE_ID)
  console.log('[Workspace] Added default space ID:', DEFAULT_SPACE_ID)

  const tasks: Promise<void>[] = []

  // Lookup by phone -> app_user.phone
  if (options.phoneNumber && options.includePhoneLookup !== false) {
    const digits = normalizeDigits(options.phoneNumber)
    if (digits.length === 10) {
      tasks.push((async () => {
        try {
          console.log('[Workspace] Querying app_user for phone digits:', digits)
          const controller = new AbortController()
          const timeoutId = setTimeout(() => {
            controller.abort()
            console.error('[Workspace] app_user lookup timed out after 3000ms')
          }, 3000)

          const { data, error } = await client
            .from('app_user')
            .select('space_id, phone')
            .ilike('phone', `%${digits}`)
            .limit(25)
            .abortSignal(controller.signal)

          clearTimeout(timeoutId)

          if (error) {
            console.error('[Workspace] app_user lookup failed:', error)
            return
          }

          const rows = (data ?? []) as AppUserRow[]
          console.log(`[Workspace] app_user lookup returned ${rows.length} rows`)
          for (const row of rows) {
            if (!row?.space_id) continue
            const rowDigits = normalizeDigits(String(row.phone || ''))
            if (rowDigits === digits) {
              resolved.add(row.space_id)
            }
          }
        } catch (err) {
          console.error('[Workspace] Error resolving phone-based workspaces:', err)
        }
      })())
    } else {
      console.log('[Workspace] Phone digits invalid, skipping phone lookup')
    }
  } else if (options.phoneNumber) {
    console.log('[Workspace] Skipping phone lookup (disabled via options)')
  }

  // Optional SEP fallback (enabled by default)
  if (options.includeSepFallback !== false) {
    tasks.push((async () => {
      const taskStart = Date.now()
      try {
        console.log('[Workspace] Querying SEP workspaces')
        
        // Wrap entire query in timeout
        const queryWithTimeout = Promise.race([
          client
            .from('space')
            .select('id, name')
            .ilike('name', '%SEP%'),
          new Promise<{ data: null; error: { message: string } }>((resolve) => {
            setTimeout(() => {
              console.error('[Workspace] SEP workspace lookup timed out after 2000ms')
              resolve({ data: null, error: { message: 'Timeout' } })
            }, 2000)
          })
        ])

        const result = await queryWithTimeout
        const queryDuration = Date.now() - taskStart
        console.log(`[Workspace] SEP query completed in ${queryDuration}ms`)

        if (result.error) {
          console.error('[Workspace] SEP workspace lookup failed:', result.error)
          return
        }

        const rows = ((result.data ?? []) as SpaceRow[])
        console.log(`[Workspace] SEP lookup returned ${rows.length} rows`)
        for (const space of rows) {
          if (space?.id) {
            resolved.add(space.id)
          }
        }
      } catch (err) {
        const errorDuration = Date.now() - taskStart
        console.error(`[Workspace] Error retrieving SEP workspaces after ${errorDuration}ms:`, err)
      }
    })())
  }

  // Wait for tasks with overall timeout
  const allTasksStart = Date.now()
  try {
    await Promise.race([
      Promise.all(tasks),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          console.error('[Workspace] All workspace tasks timed out after 3000ms')
          resolve()
        }, 3000)
      })
    ])
  } catch (err) {
    console.error('[Workspace] Error waiting for workspace tasks:', err)
  }
  const allTasksDuration = Date.now() - allTasksStart
  console.log(`[Workspace] All tasks completed in ${allTasksDuration}ms`)
  console.log('[Workspace] Workspace resolution after tasks:', Array.from(resolved))

  // Final fallback: grab a few spaces if we only have the default
  if (resolved.size === 1) {
    try {
      console.log('[Workspace] Running fallback workspace query (limit 10)')
      const queryPromise = client
        .from('space')
        .select('id, name')
        .limit(10)

      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) => {
        setTimeout(() => {
          console.error('[Workspace] Fallback workspace lookup timed out after 2000ms')
          resolve({ data: null, error: { message: 'Timeout' } })
        }, 2000)
      })

      const result = await Promise.race([queryPromise, timeoutPromise])

      if (result.error) {
        console.error('[Workspace] Fallback workspace lookup failed:', result.error)
      } else {
        const rows = ((result.data ?? []) as SpaceRow[])
        console.log(`[Workspace] Fallback lookup returned ${rows.length} rows`)
        for (const space of rows) {
          if (space?.id) {
            resolved.add(space.id)
          }
        }
      }
    } catch (err) {
      console.error('[Workspace] Error retrieving fallback workspaces:', err)
    }
  }

  const workspaceIds = Array.from(resolved)
  console.log('[Workspace] Workspace IDs resolved:', workspaceIds)
  
  // Safety check: if we only have default workspace, log warning but return it
  if (workspaceIds.length === 1 && workspaceIds[0] === DEFAULT_SPACE_ID) {
    console.warn('[Workspace] Only default workspace ID found - searches may return empty results')
  }
  
  return workspaceIds
}

