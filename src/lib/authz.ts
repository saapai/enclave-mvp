import { clerkClient } from '@clerk/nextjs/server'
import { supabase } from './supabase'

export async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId)
    const email = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress
    return email || null
  } catch {
    return null
  }
}

export async function assertMembership(userId: string, spaceId: string): Promise<boolean> {
  const isDev = process.env.NODE_ENV !== 'production'
  if (isDev) return true
  const email = await getUserEmail(userId)
  if (!email) return false
  const { data } = await supabase
    .from('app_user')
    .select('id')
    .eq('space_id', spaceId)
    .eq('email', email)
    .limit(1)
  return Array.isArray(data) && data.length > 0
}


