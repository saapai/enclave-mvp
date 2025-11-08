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

  const promises: Promise<void>[] = []

  // Lookup by phone -> app_user.phone
  if (options.phoneNumber) {
    const digits = normalizeDigits(options.phoneNumber)
    if (digits.length === 10) {
      promises.push((async () => {
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

  // Always try SEP-named workspaces if requested or nothing yet
  promises.push((async () => {
    if (!options.includeSepFallback && resolved.size > 1) return
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

  // Fallback: fetch all spaces (limited) if still only default
  promises.push((async () => {
    await Promise.all(promises)
    if (resolved.size > 1) return
    try {
      const { data, error } = await client
        .from('space')
        .select('id, name')
        .limit(10)

      if (error) {
        console.error('[Workspace] Fallback workspace lookup failed:', error)
        return
      }

      (data || []).forEach(space => {
        if (space?.id) resolved.add(space.id)
      })
    } catch (err) {
      console.error('[Workspace] Error retrieving fallback workspaces:', err)
    }
  })())

  await Promise.all(promises)

  const workspaceIds = Array.from(resolved)
  console.log('[Workspace] Workspace IDs resolved:', workspaceIds)
  return workspaceIds
}

