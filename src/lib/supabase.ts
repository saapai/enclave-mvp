import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'
import { ENV } from './env'

const supabaseUrl = ENV.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

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
        fetch: (url, init) => {
          // Add timeout to prevent hangs (15s to allow for lexical search)
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s max for any DB query
          
          return fetch(url, {
            ...init,
            signal: controller.signal
          }).finally(() => clearTimeout(timeoutId))
        }
      }
    }
  )
})() : null
