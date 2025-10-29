/**
 * Test Airtable connection and configuration
 * Run with: node scripts/test-airtable.js
 */

require('dotenv').config({ path: '.env.local' })

const API_KEY = process.env.AIRTABLE_API_KEY
const BASE_ID = process.env.AIRTABLE_BASE_ID
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME
const TABLE_ID = process.env.AIRTABLE_TABLE_ID

console.log('🔍 Airtable Configuration Check:\n')
console.log(`API Key: ${API_KEY ? '✅ Set (' + API_KEY.substring(0, 10) + '...)' : '❌ Missing'}`)
console.log(`Base ID: ${BASE_ID ? '✅ Set (' + BASE_ID + ')' : '❌ Missing'}`)
console.log(`Table Name: ${TABLE_NAME ? '✅ Set (' + TABLE_NAME + ')' : '❌ Missing'}`)
console.log(`Table ID: ${TABLE_ID ? '✅ Set (' + TABLE_ID + ')' : '❌ Missing'}\n`)

if (!API_KEY || !BASE_ID) {
  console.error('❌ Missing required environment variables')
  process.exit(1)
}

// Test 1: List bases (to verify API key permissions)
console.log('📋 Test 1: Verifying API key permissions...')
try {
  const basesRes = await fetch('https://api.airtable.com/v0/meta/bases', {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    }
  })
  
  if (!basesRes.ok) {
    const error = await basesRes.json()
    console.error('❌ API key invalid or insufficient permissions')
    console.error('Error:', error)
    process.exit(1)
  }
  
  const bases = await basesRes.json()
  console.log(`✅ API key valid - access to ${bases.bases?.length || 0} bases`)
  
  // Check if our base ID is in the list
  const hasBase = bases.bases?.some((b: any) => b.id === BASE_ID)
  if (!hasBase && BASE_ID) {
    console.warn(`⚠️  Base ID "${BASE_ID}" not found in accessible bases`)
    console.log('Available bases:', bases.bases?.map((b: any) => ({ id: b.id, name: b.name })))
  }
} catch (err) {
  console.error('❌ Failed to fetch bases:', err)
  process.exit(1)
}

// Test 2: Get table schema (using table name)
if (TABLE_NAME) {
  console.log(`\n📊 Test 2: Fetching table schema for "${TABLE_NAME}"...`)
  try {
    const tableUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`
    const tableRes = await fetch(tableUrl + '?maxRecords=1', {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!tableRes.ok) {
      const error = await tableRes.json()
      console.error('❌ Failed to access table by name')
      console.error('Error:', error)
      
      if (error.error?.message?.includes('could not find') || error.error?.message?.includes('not found')) {
        console.error('\n💡 The table name might be incorrect or the API key doesn\'t have access to this table.')
        console.error('💡 Try using the table ID instead, or check the table name spelling.')
      }
    } else {
      const data = await tableRes.json()
      console.log(`✅ Table "${TABLE_NAME}" accessible`)
      console.log(`   Records: ${data.records?.length || 0} (first page)`)
      
      // Check for required fields
      if (data.records?.[0]?.fields) {
        const fields = Object.keys(data.records[0].fields)
        console.log(`   Fields: ${fields.length} fields found`)
        console.log(`   Field names: ${fields.slice(0, 5).join(', ')}${fields.length > 5 ? '...' : ''}`)
        
        if (!fields.includes('phone number')) {
          console.warn('⚠️  Field "phone number" not found!')
          console.warn('   You need to create a field named "phone number" in Airtable.')
          console.warn('   This is the field used to find/update records by phone number.')
        } else {
          console.log('✅ Field "phone number" exists')
        }
        
        if (!fields.includes('Person')) {
          console.warn('⚠️  Field "Person" not found!')
          console.warn('   You need to create a field named "Person" to store names.')
        } else {
          console.log('✅ Field "Person" exists')
        }
      }
    }
  } catch (err) {
    console.error('❌ Failed to fetch table:', err)
  }
}

// Test 3: Test Metadata API (if table ID is provided)
if (TABLE_ID) {
  console.log(`\n🔧 Test 3: Testing Metadata API with Table ID "${TABLE_ID}"...`)
  try {
    const metaUrl = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${TABLE_ID}`
    const metaRes = await fetch(metaUrl, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!metaRes.ok) {
      const error = await metaRes.json()
      console.error('❌ Metadata API access failed')
      console.error('Error:', error)
      
      if (error.error?.message?.includes('Invalid permissions')) {
        console.error('\n💡 Your API key needs "schema.bases:read" scope for the Metadata API.')
        console.error('💡 For regular API operations, you might need a different API key.')
      }
    } else {
      const meta = await metaRes.json()
      console.log(`✅ Metadata API accessible`)
      console.log(`   Table name: ${meta.name}`)
      console.log(`   Fields: ${meta.schema?.fields?.length || 0}`)
      
      if (meta.schema?.fields) {
        const fieldNames = meta.schema.fields.map((f: any) => f.name)
        console.log(`   Field names: ${fieldNames.slice(0, 10).join(', ')}${fieldNames.length > 10 ? '...' : ''}`)
      }
    }
  } catch (err) {
    console.error('❌ Metadata API test failed:', err)
  }
}

// Test 4: Try a simple upsert
console.log(`\n✍️  Test 4: Testing upsert (read-only test - won't create record)...`)
try {
  const testPhone = '+13853687238'
  const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?filterByFormula=${encodeURIComponent(`{phone number} = "${testPhone}"`)}&maxRecords=1`
  
  const searchRes = await fetch(searchUrl, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    }
  })
  
  if (!searchRes.ok) {
    const error = await searchRes.json()
    console.error('❌ Failed to search for records')
    console.error('Error:', error)
    
    if (error.error?.message?.includes('Could not find')) {
      console.error('\n💡 Check that:')
      console.error('   1. The base ID is correct')
      console.error('   2. The table name is spelled exactly as it appears in Airtable')
      console.error('   3. The API key has access to this base/table')
    }
  } else {
    const data = await searchRes.json()
    console.log(`✅ Search query works`)
    console.log(`   Found ${data.records?.length || 0} records with phone "${testPhone}"`)
  }
} catch (err) {
  console.error('❌ Search test failed:', err)
}

console.log('\n✅ All tests complete!')
console.log('\n📝 Next steps if errors found:')
console.log('   1. Verify API key has access to the base')
console.log('   2. Create "phone number" field in Airtable (if missing)')
console.log('   3. Create "Person" field in Airtable (if missing)')
console.log('   4. For Metadata API, ensure API key has schema.bases:read scope')

