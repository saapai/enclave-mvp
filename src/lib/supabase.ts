import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'
import { ENV } from './env'

const supabaseUrl = ENV.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

function mergeAbortSignals(timeoutMs: number, incoming?: AbortSignal | null): { signal: AbortSignal; dispose: () => void } {
  const timeoutController = new AbortController()
  let incomingListener: (() => void) | null = null

  if (incoming) {
    if (incoming.aborted) {
      timeoutController.abort()
    } else {
      incomingListener = () => timeoutController.abort()
      incoming.addEventListener('abort', incomingListener, { once: true })
    }
  }

  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)

  const dispose = () => {
    clearTimeout(timeoutId)
    if (incoming && incomingListener) {
      incoming.removeEventListener('abort', incomingListener)
    }
  }

  return { signal: timeoutController.signal, dispose }
}

// Server-side client with service role key for admin operations
// Only create this on the server side to avoid client-side environment variable issues
export const supabaseAdmin = typeof window === 'undefined' ? (() => {
  const serviceRoleKey = ENV.SUPABASE_SERVICE_ROLE_KEY
  
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not defined')
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
  }

  return createClient<Database>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      db: {
        schema: 'public'
      },
      global: {
        headers: {
          'Connection': 'keep-alive'
        },
        fetch: (url, init = {}) => {
          const { signal: mergedSignal, dispose } = mergeAbortSignals(15000, init.signal)
          return fetch(url, {
            ...init,
            signal: mergedSignal
          }).finally(() => dispose())
        }
      }
    }
  )
})() : null
