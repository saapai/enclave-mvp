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

  // Twilio SMS
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
  
  // Airtable
  AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY || '',
  AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID || '',
  AIRTABLE_TABLE_ID: process.env.AIRTABLE_TABLE_ID || '', // Table ID for Metadata API
  AIRTABLE_TABLE_NAME: process.env.AIRTABLE_TABLE_NAME || '',
  AIRTABLE_PUBLIC_RESULTS_URL: process.env.AIRTABLE_PUBLIC_RESULTS_URL || '',
  // Airtable field names (configurable - must match your Airtable table exactly)
  AIRTABLE_PHONE_FIELD: process.env.AIRTABLE_PHONE_FIELD || 'phone number',
  AIRTABLE_PERSON_FIELD: process.env.AIRTABLE_PERSON_FIELD || 'Person',
}


