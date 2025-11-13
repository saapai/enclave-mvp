import fs from 'fs'
import path from 'path'

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

if (process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL
}
if (process.env.SUPABASE_ANON_KEY && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
}

const TEST_PHONE = '3853687238'
const TEST_PHONE_E164 = '+13853687238'

const QUERIES = [
  'When is big little',
  'When is ae summons',
  'When is active meeting'
]

async function run(): Promise<void> {
  const { handleSMSMessage } = await import('../src/lib/sms/unified-handler')
  console.log('Running quick SMS pipeline test...\n')
  for (const query of QUERIES) {
    const start = Date.now()
    try {
      const result = await handleSMSMessage(
        TEST_PHONE,
        TEST_PHONE_E164,
        query
      )
      const duration = Date.now() - start
      console.log(`✓ ${query}`)
      console.log(`  Duration: ${duration}ms`)
      console.log(`  Response: ${result.response}\n`)
    } catch (err) {
      console.error(`✗ ${query}`)
      console.error(`  Error:`, err, '\n')
    }
  }
}

run().catch((err) => {
  console.error('Test run failed:', err)
  process.exit(1)
})

