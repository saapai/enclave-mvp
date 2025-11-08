/**
 * Workspace utilities
 */

import { supabase, supabaseAdmin } from '@/lib/supabase'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

// Cache workspace lookups for 5 minutes to avoid slow Supabase queries
const workspaceCache = new Map<string, { workspaces: string[]; timestamp: number }>()
const WORKSPACE_CACHE_TTL = 300000 // 5 minutes (increased from 2)

// Last successful workspace lookup (fallback if cache expires and query fails)
const lastKnownWorkspaces = new Map<string, string[]>()

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
 * CRITICAL: This must complete quickly (<500ms) or return cached/fallback values
 */
async function getWorkspaceIdsInternal(options: WorkspaceOptions = {}): Promise<string[]> {
  const startTime = Date.now()
  console.log('[Workspace] getWorkspaceIds called with options:', options)
  
  // Check cache first (use phone number as cache key if available)
  const cacheKey = options.phoneNumber || 'default'
  const cached = workspaceCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < WORKSPACE_CACHE_TTL) {
    console.log(`[Workspace] Using cached workspaces for ${cacheKey} (${cached.workspaces.length} workspaces)`)
    return cached.workspaces
  }
  
  const client = supabaseAdmin || supabase

  if (!client) {
    console.error('[Workspace] No Supabase client available')
    // Return last known workspaces or default
    const lastKnown = lastKnownWorkspaces.get(cacheKey)
    return lastKnown || [DEFAULT_SPACE_ID]
  }

  const resolved = new Set<string>()

  // CRITICAL FIX: Query with aggressive timeout and immediate fallback
  try {
    console.log('[Workspace] Querying spaces with 400ms timeout')
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 400) // Very aggressive timeout
    
    const queryPromise = client
      .from('space')
      .select('id, name')
      .limit(10) // Reduced from 20
      .abortSignal(controller.signal)
    
    const { data, error } = await queryPromise
    clearTimeout(timeoutId)
    
    if (error) {
      console.error('[Workspace] Space query error:', error.message)
      throw error
    }
    
    const rows = (data ?? []) as SpaceRow[]
    console.log(`[Workspace] Space query returned ${rows.length} rows in ${Date.now() - startTime}ms`)
    
    // Filter for SEP workspaces in memory
    for (const row of rows) {
      if (!row?.id) continue
      const name = (row.name || '').toUpperCase()
      if (name.includes('SEP')) {
        resolved.add(row.id)
        console.log(`[Workspace] Added SEP workspace: ${row.name} (${row.id})`)
      }
    }
    
  } catch (err: any) {
    console.error(`[Workspace] Space query failed after ${Date.now() - startTime}ms:`, err.message)
    
    // Return last known workspaces immediately
    const lastKnown = lastKnownWorkspaces.get(cacheKey)
    if (lastKnown && lastKnown.length > 0) {
      console.log(`[Workspace] Using last known workspaces (${lastKnown.length} workspaces)`)
      // Cache it again
      workspaceCache.set(cacheKey, { workspaces: lastKnown, timestamp: Date.now() })
      return lastKnown
    }
    
    // If no last known, return default only
    console.log('[Workspace] No last known workspaces, returning default only')
    return [DEFAULT_SPACE_ID]
  }

  const workspaces = Array.from(resolved)
  
  // If we found workspaces, cache them and save as last known
  if (workspaces.length > 0) {
    console.log(`[Workspace] Resolved ${workspaces.length} workspaces in ${Date.now() - startTime}ms`)
    workspaceCache.set(cacheKey, { workspaces, timestamp: Date.now() })
    lastKnownWorkspaces.set(cacheKey, workspaces)
    return workspaces
  }
  
  // No workspaces found, return default
  console.log('[Workspace] No SEP workspaces found, returning default')
  const fallback = [DEFAULT_SPACE_ID]
  workspaceCache.set(cacheKey, { workspaces: fallback, timestamp: Date.now() })
  return fallback
}

/**
 * Public API with hard timeout wrapper
 */
export async function getWorkspaceIds(options: WorkspaceOptions = {}): Promise<string[]> {
  const cacheKey = options.phoneNumber || 'default'
  
  try {
    // Hard 500ms timeout for the entire operation
    const result = await Promise.race([
      getWorkspaceIdsInternal(options),
      new Promise<string[]>((_, reject) => 
        setTimeout(() => reject(new Error('getWorkspaceIds timeout')), 500)
      )
    ])
    
    console.log(`[Workspace] getWorkspaceIds completed, returning ${result.length} workspaces`)
    return result
  } catch (err: any) {
    console.error('[Workspace] getWorkspaceIds timed out, using fallback')
    
    // Try last known first
    const lastKnown = lastKnownWorkspaces.get(cacheKey)
    if (lastKnown && lastKnown.length > 0) {
      console.log(`[Workspace] Returning last known workspaces (${lastKnown.length})`)
      return lastKnown
    }
    
    // Otherwise return default
    console.log('[Workspace] Returning default workspace')
    return [DEFAULT_SPACE_ID]
  }
}

/**
 * Pre-warm the workspace cache (call this on app startup or periodically)
 */
export async function prewarmWorkspaceCache(): Promise<void> {
  console.log('[Workspace] Pre-warming workspace cache...')
  try {
    await getWorkspaceIds({ includeSepFallback: true, includePhoneLookup: false })
  } catch (err) {
    console.error('[Workspace] Failed to pre-warm cache:', err)
  }
}

/**
 * Clear the workspace cache (for testing or manual refresh)
 */
export function clearWorkspaceCache(): void {
  workspaceCache.clear()
  console.log('[Workspace] Cache cleared')
}
