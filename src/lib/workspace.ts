/**
 * Workspace utilities
 */

import { supabase, supabaseAdmin } from '@/lib/supabase'

/**
 * Get all SEP workspace IDs
 */
export async function getWorkspaceIds(): Promise<string[]> {
  const client = supabaseAdmin || supabase

  if (!client) {
    console.error('[Workspace] No Supabase client available')
    return []
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
      console.error('[Workspace] Workspace query timed out after 3000ms')
    }, 3000)

    const { data: sepWorkspaces, error } = await client
      .from('space')
      .select('id, name')
      .ilike('name', '%SEP%')
      .abortSignal(controller.signal)

    clearTimeout(timeoutId)

    if (error) {
      console.error('[Workspace] Failed to load SEP workspaces:', error)
    }

    let workspaceData = sepWorkspaces || []

    if (!workspaceData.length) {
      console.warn('[Workspace] No SEP workspaces found. Falling back to all spaces.')
      const fallbackController = new AbortController()
      const fallbackTimeout = setTimeout(() => {
        fallbackController.abort()
        console.error('[Workspace] Fallback workspace query timed out after 3000ms')
      }, 3000)

      const { data: allSpaces, error: fallbackError } = await client
        .from('space')
        .select('id, name')
        .limit(10)
        .abortSignal(fallbackController.signal)

      clearTimeout(fallbackTimeout)

      if (fallbackError) {
        console.error('[Workspace] Failed to load fallback workspaces:', fallbackError)
        return []
      }

      workspaceData = allSpaces || []
    }

    const unique = Array.from(new Set(workspaceData.map(w => w.id)))
    console.log('[Workspace] Workspace IDs resolved:', workspaceData.map(w => ({ id: w.id, name: w.name })))
    return unique
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[Workspace] Workspace query aborted due to timeout')
    } else {
      console.error('[Workspace] Unexpected error resolving workspaces:', err)
    }
    return []
  }
}

