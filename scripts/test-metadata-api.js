#!/usr/bin/env node

/**
 * Test Airtable Metadata API access
 * This script tests if your PAT can access the Metadata API
 */

require('dotenv').config({ path: '.env.local' })

const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appecxe8XTHF7yA5a'
const TABLE_ID = process.env.AIRTABLE_TABLE_ID || 'tblfvnRHv6McCSwIR'
const PAT = process.env.AIRTABLE_API_KEY

if (!PAT) {
  console.error('❌ AIRTABLE_API_KEY not set')
  process.exit(1)
}

console.log('🔍 Testing Airtable Metadata API Access\n')
console.log(`Base ID: ${BASE_ID}`)
console.log(`Table ID: ${TABLE_ID}`)
console.log(`PAT preview: ${PAT.substring(0, 10)}... (length: ${PAT.length})\n`)

async function testMetadataAPI() {
  try {
    // Step 1: Test base access
    console.log('Step 1: Testing base access...')
    const baseUrl = `https://api.airtable.com/v0/meta/bases/${BASE_ID}`
    console.log(`URL: ${baseUrl}\n`)
    
    const baseRes = await fetch(baseUrl, {
      headers: {
        'Authorization': `Bearer ${PAT.trim()}`,
        'Content-Type': 'application/json'
      }
    })
    
    const baseData = await baseRes.json()
    
    if (baseRes.ok) {
      console.log('✅ Base access SUCCESS!')
      console.log(`   Base name: ${baseData?.name || 'Unknown'}`)
      console.log(`   Tables: ${baseData?.tables?.length || 0} found\n`)
      
      // List all tables
      if (baseData?.tables && baseData.tables.length > 0) {
        console.log('   Available tables:')
        baseData.tables.forEach((table, i) => {
          const marker = table.id === TABLE_ID ? '👉' : '  '
          console.log(`   ${marker} ${i + 1}. ${table.name} (${table.id})`)
        })
        console.log()
      }
    } else {
      console.error('❌ Base access FAILED')
      console.error(`   Status: ${baseRes.status}`)
      console.error(`   Error: ${baseData?.error?.message || JSON.stringify(baseData)}`)
      process.exit(1)
    }
    
    // Step 2: Test table access
    console.log('Step 2: Testing table access...')
    const tableUrl = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${TABLE_ID}`
    console.log(`URL: ${tableUrl}\n`)
    
    const tableRes = await fetch(tableUrl, {
      headers: {
        'Authorization': `Bearer ${PAT.trim()}`,
        'Content-Type': 'application/json'
      }
    })
    
    const tableData = await tableRes.json()
    
    if (tableRes.ok) {
      console.log('✅ Table access SUCCESS!')
      console.log(`   Table name: ${tableData?.name || 'Unknown'}`)
      console.log(`   Fields: ${tableData?.schema?.fields?.length || 0} found\n`)
      
      // List first few fields
      if (tableData?.schema?.fields && tableData.schema.fields.length > 0) {
        console.log('   First 5 fields:')
        tableData.schema.fields.slice(0, 5).forEach((field, i) => {
          console.log(`     ${i + 1}. ${field.name} (${field.type})`)
        })
        if (tableData.schema.fields.length > 5) {
          console.log(`     ... and ${tableData.schema.fields.length - 5} more`)
        }
      }
    } else {
      console.error('❌ Table access FAILED')
      console.error(`   Status: ${tableRes.status}`)
      console.error(`   Error: ${tableData?.error?.message || JSON.stringify(tableData)}`)
      console.error('\n💡 Troubleshooting:')
      console.error('   1. Verify TABLE_ID matches one of the tables listed above')
      console.error('   2. Check if PAT has schema.bases:read scope')
      console.error('   3. Verify PAT has access to this base')
      process.exit(1)
    }
    
    console.log('\n✅ All tests passed! Your PAT is correctly configured.')
    
  } catch (err) {
    console.error('❌ Test failed with error:', err.message)
    process.exit(1)
  }
}

testMetadataAPI()

