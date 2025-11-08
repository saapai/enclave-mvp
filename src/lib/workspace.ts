/**
 * Workspace utilities
 */

import { supabase, supabaseAdmin } from '@/lib/supabase'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

interface WorkspaceOptions {
  phoneNumber?: string
  includeSepFallback?: boolean
}

function normalizeDigits(phone: string): string {
  return phone.replace(/[^\d]/g, '').slice(-10)
}

/**
 * Resolve workspace IDs for a given context (phone, SEP fallback, etc.)
 */
export async function getWorkspaceIds(options: WorkspaceOptions = {}): Promise<string[]> {
  const client = supabaseAdmin || supabase

  if (!client) {
    console.error('[Workspace] No Supabase client available')
    return [DEFAULT_SPACE_ID]
  }

  const resolved = new Set<string>()
  resolved.add(DEFAULT_SPACE_ID)

  const tasks: Promise<void>[] = []

  // Lookup by phone -> app_user.phone
  if (options.phoneNumber) {
    const digits = normalizeDigits(options.phoneNumber)
    if (digits.length === 10) {
      tasks.push((async () => {
        try {
          const { data, error } = await client
            .from('app_user')
            .select('space_id, phone')
            .not('phone', 'is', null)

          if (error) {
            console.error('[Workspace] app_user lookup failed:', error)
            return
          }

          (data || []).forEach(row => {
            if (!row?.space_id) return
            const rowDigits = normalizeDigits(String(row.phone || ''))
            if (rowDigits === digits) {
              resolved.add(row.space_id)
            }
          })
        } catch (err) {
          console.error('[Workspace] Error resolving phone-based workspaces:', err)
        }
      })())
    }
  }

  // Optional SEP fallback (enabled by default)
  if (options.includeSepFallback !== false) {
    tasks.push((async () => {
      try {
        const { data, error } = await client
          .from('space')
          .select('id, name')
          .ilike('name', '%SEP%')

        if (error) {
          console.error('[Workspace] SEP workspace lookup failed:', error)
          return
        }

        (data || []).forEach(space => {
          if (space?.id) resolved.add(space.id)
        })
      } catch (err) {
        console.error('[Workspace] Error retrieving SEP workspaces:', err)
      }
    })())
  }

  await Promise.all(tasks)

  // Final fallback: grab a few spaces if we only have the default
  if (resolved.size === 1) {
    try {
      const { data, error } = await client
        .from('space')
        .select('id, name')
        .limit(10)

      if (error) {
        console.error('[Workspace] Fallback workspace lookup failed:', error)
      } else {
        (data || []).forEach(space => {
          if (space?.id) resolved.add(space.id)
        })
      }
    } catch (err) {
      console.error('[Workspace] Error retrieving fallback workspaces:', err)
    }
  }

  const workspaceIds = Array.from(resolved)
  console.log('[Workspace] Workspace IDs resolved:', workspaceIds)
  return workspaceIds
}

