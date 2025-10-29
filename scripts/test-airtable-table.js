/**
 * Test Airtable table access - specifically for table name issues
 * Run with: node scripts/test-airtable-table.js "Enclave"
 */

require('dotenv').config({ path: '.env.local' })

const API_KEY = process.env.AIRTABLE_API_KEY
const BASE_ID = process.env.AIRTABLE_BASE_ID
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || process.argv[2] || 'Enclave'

if (!API_KEY || !BASE_ID) {
  console.error('❌ Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID')
  process.exit(1)
}

async function testTableAccess() {
  console.log(`\n🧪 Testing Airtable Table Access\n`)
  console.log(`Base ID: ${BASE_ID}`)
  console.log(`Table Name: "${TABLE_NAME}"`)
  console.log(`API Key: ${API_KEY.substring(0, 10)}...\n`)

  // Test 1: Try to list records (this will fail if table doesn't exist)
  console.log('📋 Test 1: Fetching records from table...')
  const tableUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?maxRecords=1`
  console.log(`URL: ${tableUrl}\n`)
  
  try {
    const res = await fetch(tableUrl, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    
    const data = await res.json()
    
    if (!res.ok) {
      console.error('❌ Failed to access table')
      console.error('Status:', res.status)
      console.error('Error:', JSON.stringify(data, null, 2))
      
      if (data.error?.message?.includes('Could not find') || data.error?.message?.includes('not found')) {
        console.error('\n💡 The table name might be incorrect.')
        console.error('💡 Try these steps:')
        console.error('   1. Check the exact table name in Airtable (case-sensitive!)')
        console.error('   2. The table name in your base might be different')
        console.error('   3. Ensure the API key has access to this base')
        
        // Try to list all tables in the base
        console.error('\n📋 Attempting to list all tables in base...')
        await listTablesInBase()
      } else if (data.error?.message?.includes('Invalid permissions')) {
        console.error('\n💡 Permission issue:')
        console.error('   1. Check API key has access to the base')
        console.error('   2. Share the base with the workspace/user that owns the API key')
      }
      
      process.exit(1)
    }
    
    console.log('✅ Table accessible!')
    console.log(`   Records found: ${data.records?.length || 0}`)
    
    if (data.records?.[0]?.fields) {
      const fields = Object.keys(data.records[0].fields)
      console.log(`   Fields: ${fields.length}`)
      console.log(`   Field names: ${fields.join(', ')}`)
    }
    
  } catch (err) {
    console.error('❌ Request failed:', err.message)
    process.exit(1)
  }

  // Test 2: Try a filterByFormula query
  console.log('\n🔍 Test 2: Testing filterByFormula query...')
  const phoneField = process.env.AIRTABLE_PHONE_FIELD || 'phone number'
  const testPhone = '+13853687238'
  const filterUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?filterByFormula=${encodeURIComponent(`{${phoneField}} = "${testPhone}"`)}&maxRecords=1`
  
  try {
    const res = await fetch(filterUrl, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    
    const data = await res.json()
    
    if (!res.ok) {
      console.error('❌ Filter query failed')
      console.error('Status:', res.status)
      console.error('Error:', JSON.stringify(data, null, 2))
      
      if (data.error?.message?.includes('Unknown field')) {
        console.error(`\n💡 Field "${phoneField}" not found in table.`)
        console.error(`   Try setting AIRTABLE_PHONE_FIELD to match your actual field name.`)
      }
    } else {
      console.log('✅ Filter query works!')
      console.log(`   Found ${data.records?.length || 0} records`)
    }
  } catch (err) {
    console.error('❌ Filter query failed:', err.message)
  }
}

async function listTablesInBase() {
  try {
    // Try to get base schema via Metadata API
    const metaUrl = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`
    const res = await fetch(metaUrl, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (res.ok) {
      const data = await res.json()
      console.log('\n📊 Tables in this base:')
      data.tables?.forEach((table: any) => {
        console.log(`   - "${table.name}" (ID: ${table.id})`)
      })
      console.log(`\n💡 Use the exact table name from above for AIRTABLE_TABLE_NAME`)
    } else {
      const error = await res.json()
      console.error('❌ Could not list tables:', error)
      console.error('   (Metadata API requires schema.bases:read scope)')
    }
  } catch (err) {
    console.error('❌ Failed to list tables:', err.message)
  }
}

testTableAccess()

