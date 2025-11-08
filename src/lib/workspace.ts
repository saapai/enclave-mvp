/**
 * Workspace utilities
 */

import { supabase, supabaseAdmin } from '@/lib/supabase'

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

// Cache workspace lookups for 2 minutes to avoid slow Supabase queries
const workspaceCache = new Map<string, { workspaces: string[]; timestamp: number }>()
const WORKSPACE_CACHE_TTL = 120000 // 2 minutes

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
async function getWorkspaceIdsInternal(options: WorkspaceOptions = {}): Promise<string[]> {
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
    return [DEFAULT_SPACE_ID]
  }

  const resolved = new Set<string>()
  resolved.add(DEFAULT_SPACE_ID)
  console.log('[Workspace] Added default space ID:', DEFAULT_SPACE_ID)

  // Allow hardcoded workspace fallbacks via environment variables
  const fallbackIdsEnv =
    process.env.WORKSPACE_FALLBACK_IDS ||
    process.env.SEP_SPACE_ID ||
    ''
  if (fallbackIdsEnv) {
    const fallbackIds = fallbackIdsEnv
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    if (fallbackIds.length > 0) {
      console.log('[Workspace] Using fallback workspace IDs from env:', fallbackIds)
      for (const id of fallbackIds) {
        resolved.add(id)
      }
    }
  }

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
  // SKIP SEP query - it's hanging. Use direct query with hard timeout
  if (options.includeSepFallback !== false && !process.env.SKIP_WORKSPACE_DB) {
    tasks.push((async () => {
      const taskStart = Date.now()
      try {
        console.log('[Workspace] Querying all workspaces (skipping SEP filter due to hang)')
        
        // CRITICAL: Wrap entire query in Promise.race with hard 1s timeout
        // AbortController alone doesn't work fast enough when Supabase is slow
        const queryPromise = (async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => {
            controller.abort()
          }, 1000)

          try {
            const result = await client
              .from('space')
              .select('id, name')
              .limit(20)
              .abortSignal(controller.signal)
            
            clearTimeout(timeoutId)
            return result
          } catch (err: any) {
            clearTimeout(timeoutId)
            throw err
          }
        })()
        
        const timeoutMs = Number(process.env.WORKSPACE_QUERY_TIMEOUT_MS || 1000)
        const timeoutPromise = new Promise<{ data: null; error: any }>((resolve) => {
          setTimeout(() => {
            console.error(`[Workspace] Query hard timeout after ${timeoutMs}ms`)
            resolve({ data: null, error: { message: 'Hard timeout' } })
          }, timeoutMs)
        })
        
        const result = await Promise.race([queryPromise, timeoutPromise])
        const data = result.data
        const error = result.error
        
        const queryDuration = Date.now() - taskStart
        console.log(`[Workspace] Workspace query completed in ${queryDuration}ms`)

        if (error) {
          console.error('[Workspace] Workspace lookup failed:', error)
          // CRITICAL: If query times out, use hardcoded SEP workspace from env
          if (process.env.SEP_SPACE_ID) {
            console.log('[Workspace] Using hardcoded SEP_SPACE_ID from env as fallback')
            resolved.add(process.env.SEP_SPACE_ID)
          }
          return
        }

        const rows = ((data ?? []) as SpaceRow[])
        console.log(`[Workspace] Workspace lookup returned ${rows.length} rows`)
        
        // Filter for SEP workspaces in memory (faster than DB ilike)
        for (const space of rows) {
          if (space?.id && space?.name && space.name.toLowerCase().includes('sep')) {
            resolved.add(space.id)
          }
        }
        
        // If no SEP workspaces found, add all workspaces as fallback
        if (resolved.size === 1) {
          console.log('[Workspace] No SEP workspaces found, using all workspaces as fallback')
          for (const space of rows) {
            if (space?.id) {
              resolved.add(space.id)
            }
          }
        }
      } catch (err) {
        const errorDuration = Date.now() - taskStart
        console.error(`[Workspace] Error retrieving workspaces after ${errorDuration}ms:`, err)
      }
    })())
  }

  // Wait for tasks with overall timeout
  const allTasksStart = Date.now()
  try {
    await Promise.race([
      Promise.all(tasks),
      new Promise<void>((resolve) => {
        const timeoutMs = Number(process.env.WORKSPACE_TASK_TIMEOUT_MS || 2000)
        setTimeout(() => {
          console.error(`[Workspace] All workspace tasks timed out after ${timeoutMs}ms`)
          resolve()
        }, timeoutMs)
      })
    ])
  } catch (err) {
    console.error('[Workspace] Error waiting for workspace tasks:', err)
  }
  const allTasksDuration = Date.now() - allTasksStart
  console.log(`[Workspace] All tasks completed in ${allTasksDuration}ms`)
  console.log('[Workspace] Workspace resolution after tasks:', Array.from(resolved))

  if (resolved.size > 1 && resolved.has(DEFAULT_SPACE_ID)) {
    console.log('[Workspace] Removing default workspace (other workspaces found)')
    resolved.delete(DEFAULT_SPACE_ID)
  }

  // Final fallback: grab a few spaces if we only have the default
  if (resolved.size === 1 && resolved.has(DEFAULT_SPACE_ID)) {
    try {
      console.log('[Workspace] Running fallback workspace query (limit 10)')
          
          const controller = new AbortController()
          const timeoutId = setTimeout(() => {
            controller.abort()
            console.error('[Workspace] Fallback workspace lookup aborted after 1500ms')
          }, 1500)

          let result: { data: any; error: any } = { data: null, error: null }
          
          try {
            result = await client
              .from('space')
              .select('id, name')
              .limit(10)
              .abortSignal(controller.signal)
          } catch (err: any) {
            if (err.name === 'AbortError') {
              result = { data: null, error: { message: 'Aborted' } }
            } else {
              result = { data: null, error: err }
            }
          } finally {
            clearTimeout(timeoutId)
          }

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
  
  // CRITICAL: Early return if only default workspace (don't search ghost space)
  if (workspaceIds.length === 0 || (workspaceIds.length === 1 && workspaceIds[0] === DEFAULT_SPACE_ID)) {
    console.warn('[Workspace] Only default workspace ID found - returning empty array to trigger early exit')
    return [] // Return empty to trigger early exit in executeAnswer
  }
  
  // Cap workspace count to prevent fan-out explosion
  const MAX_WORKSPACES = 5
  let finalWorkspaces = workspaceIds
  if (workspaceIds.length > MAX_WORKSPACES) {
    console.warn(`[Workspace] Capping workspace count from ${workspaceIds.length} to ${MAX_WORKSPACES}`)
    finalWorkspaces = workspaceIds.slice(0, MAX_WORKSPACES)
  }
  
  // Cache the result
  workspaceCache.set(cacheKey, { workspaces: finalWorkspaces, timestamp: Date.now() })
  console.log(`[Workspace] Cached ${finalWorkspaces.length} workspaces for ${cacheKey}`)
  
  return finalWorkspaces
}

/**
 * Public wrapper with hard timeout to prevent indefinite hangs
 */
export async function getWorkspaceIds(options: WorkspaceOptions = {}): Promise<string[]> {
  const timeoutMs = 2000 // 2s hard timeout
  const startTime = Date.now()
  
  try {
    const result = await Promise.race([
      getWorkspaceIdsInternal(options),
      new Promise<string[]>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`getWorkspaceIds timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      })
    ])
    
    const duration = Date.now() - startTime
    console.log(`[Workspace] getWorkspaceIds completed in ${duration}ms, returning ${result.length} workspaces`)
    return result
  } catch (err) {
    const duration = Date.now() - startTime
    console.error(`[Workspace] getWorkspaceIds failed after ${duration}ms:`, err)
    // Return default workspace on timeout/error
    return [DEFAULT_SPACE_ID]
  }
}

