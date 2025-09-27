function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`${name} is not defined`)
    throw new Error(`${name} is required`)
  }
  return v
}

export const ENV = {
  // Public keys: do not throw at build-time; validate at runtime where needed
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',

  // Server-side keys
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',

  // AI
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY || '',
}


