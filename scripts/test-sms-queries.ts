import fs from 'fs'
import path from 'path'
import { loadEnvConfig } from '@next/env'
import { handleSMSMessage } from '../src/lib/sms/unified-handler'

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^"|"$/g, '')
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvLocal()
loadEnvConfig(process.cwd(), true)

if (process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL
}
if (process.env.SUPABASE_ANON_KEY && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
}

const envStatus = {
  NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}
console.log('Supabase env status:', envStatus)

const TEST_PHONE = '3853687238'
const TEST_PHONE_E164 = '+13853687238'

const QUERIES = [
  'When is active meeting',
  'When is big little',
  'When is big little appreciation',
  'When is ae summons',
  'Explain big little',
  'When is study hall'
]

async function run(): Promise<void> {
  console.log('Running SMS pipeline test...')
  for (const query of QUERIES) {
    const start = Date.now()
    try {
      const result = await handleSMSMessage(
        TEST_PHONE,
        TEST_PHONE_E164,
        query
      )
      const duration = Date.now() - start
      console.log(`\n=== ${query} ===`)
      console.log(`Duration: ${duration}ms`)
      console.log('Response:')
      console.log(result.response)
    } catch (err) {
      console.error(`\n=== ${query} ===`)
      console.error('Error:', err)
    }
  }
}

run().catch((err) => {
  console.error('Test run failed:', err)
  process.exit(1)
})
