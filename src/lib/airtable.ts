/**
 * Normalize phone number to E.164 format for Airtable
 */
export function normalizePhoneForAirtable(phone: string): string {
  // Input: "+13853687238" or "3853687238" or "+1 385-368-7238"
  // Output: "+13853687238" (E.164)
  
  const digits = phone.replace(/[^\d]/g, '')
  
  if (digits.length === 10) {
    // US phone number without country code
    return `+1${digits}`
  } else if (digits.length === 11 && digits[0] === '1') {
    // US phone number with country code
    return `+${digits}`
  } else if (phone.startsWith('+')) {
    // Already in E.164 format
    return phone
  } else if (digits.length > 0) {
    // Default to US +1 if we have digits
    return `+1${digits.slice(-10)}`
  }
  
  return phone // Return as-is if we can't normalize
}

/**
 * Insert a record into Airtable
 */
export async function airtableInsert(
  baseId: string,
  tableName: string,
  fields: Record<string, any>
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.AIRTABLE_API_KEY
  if (!apiKey) return { ok: false, error: 'Missing AIRTABLE_API_KEY' }

  try {
    const trimmedApiKey = apiKey.trim()
    
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${trimmedApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ records: [{ fields }] })
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || 'Airtable insert failed' }
    }
    const id = data?.records?.[0]?.id
    return { ok: true, id }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Airtable request failed' }
  }
}

/**
 * Upsert a record in Airtable by phone number
 */
export async function upsertAirtableRecord(
  baseId: string,
  tableName: string,
  phone: string,
  fields: Record<string, any>
): Promise<{ ok: boolean; id?: string; error?: string; created: boolean }> {
  const apiKey = process.env.AIRTABLE_API_KEY
  if (!apiKey) {
    console.error('[Airtable] Missing AIRTABLE_API_KEY environment variable')
    return { ok: false, error: 'Missing AIRTABLE_API_KEY', created: false }
  }
  
  // Log diagnostic info (first few chars only for security)
  const keyPreview = apiKey.substring(0, 10) + (apiKey.length > 10 ? '...' : '')
  const keyLength = apiKey.length
  console.log(`[Airtable] API key preview: "${keyPreview}" (length: ${keyLength})`)
  
  // Validate token format
  if (keyLength < 30) {
    console.error(`[Airtable] ⚠️ API key is too short (${keyLength} chars). Personal Access Tokens are typically 40-80 characters long.`)
    console.error(`[Airtable] The token appears to be incomplete or truncated.`)
    console.error(`[Airtable] ACTION REQUIRED:`)
    console.error(`[Airtable] 1. Go to Vercel → Environment Variables → AIRTABLE_API_KEY`)
    console.error(`[Airtable] 2. Click "Reveal" to see the current value and check its length`)
    console.error(`[Airtable] 3. Get the FULL token from Airtable (40-80 chars, starts with "pat")`)
    console.error(`[Airtable] 4. Update the env var with the complete token`)
    console.error(`[Airtable] 5. Redeploy your application`)
  }
  
  // Validate token format (should start with 'pat' for PAT - can be pat_, patg, etc.)
  if (!apiKey.toLowerCase().startsWith('pat')) {
    console.warn('[Airtable] API key does not start with "pat" - may be using old API key instead of Personal Access Token')
    console.warn(`[Airtable] First 20 chars of key: "${apiKey.substring(0, 20)}"`)
    console.warn(`[Airtable] Expected format: "pat" followed by characters and 40+ total length`)
  } else {
    console.log(`[Airtable] ✓ Token format valid (starts with "pat", length: ${keyLength})`)
  }

  try {
    const normalizedPhone = normalizePhoneForAirtable(phone)
    
    // Get phone field name from env (defaults to "phone number")
    const phoneFieldName = process.env.AIRTABLE_PHONE_FIELD || 'phone number'
    
    // Search for existing record by phone number
    const encodedTableName = encodeURIComponent(tableName)
    const searchUrl = `https://api.airtable.com/v0/${baseId}/${encodedTableName}?filterByFormula=${encodeURIComponent(`{${phoneFieldName}} = "${normalizedPhone}"`)}`
    console.log(`[Airtable] Searching for record. Base: ${baseId}, Table: "${tableName}" (encoded: ${encodedTableName})`)
    
    // Trim whitespace from API key (common issue)
    const trimmedApiKey = apiKey.trim()
    
    const searchRes = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${trimmedApiKey}`,
        'Content-Type': 'application/json'
      }
    })
    
    const searchData = await searchRes.json()
    
    if (searchData.error) {
      // API returned an error - log details
      console.error('[Airtable] Search error:', searchData.error)
      
      // Provide helpful error for authentication issues
      if (searchData.error.type === 'AUTHENTICATION_REQUIRED') {
        console.error('[Airtable] Authentication failed. Check:')
        console.error('  1. AIRTABLE_API_KEY is set in environment variables')
        console.error('  2. API key starts with "pat_" (Personal Access Token)')
        console.error('  3. API key has no leading/trailing whitespace')
        console.error('  4. API key has correct scopes (data.records:read, data.records:write)')
        return { ok: false, error: 'Authentication required. Check API key is a valid Personal Access Token (starts with pat_)', created: false }
      }
      
      return { ok: false, error: searchData.error.message || searchData.error.type || 'Airtable search failed', created: false }
    }
    
    if (searchData.records && searchData.records.length > 0) {
      // Update existing record
      const recordId = searchData.records[0].id
      const existingFields = searchData.records[0].fields
      
      // Merge new fields with existing (don't overwrite if field doesn't exist in new fields)
      const mergedFields = { ...existingFields, ...fields }
      
      const updateUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
      console.log(`[Airtable] Updating record at: ${updateUrl}`)
      
      const trimmedApiKey = apiKey.trim()
      
      const updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${trimmedApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          records: [{
            id: recordId,
            fields: mergedFields
          }]
        })
      })
      
      const updateData = await updateRes.json()
      
      if (!updateRes.ok) {
        console.error('[Airtable] Update error:', updateData?.error || updateData)
        console.error('[Airtable] Update URL:', updateUrl)
        console.error('[Airtable] Table name used:', tableName)
        const errorMsg = updateData?.error?.message || updateData?.error?.type || 'Airtable update failed'
        
        // Provide helpful error messages
        if (errorMsg.includes('Could not find') || errorMsg.includes('not found') || updateData?.error?.type === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND') {
          return { ok: false, error: `Table "${tableName}" not found. Check table name matches exactly (case-sensitive). Current: "${tableName}"`, created: false }
        } else if (errorMsg.includes('Invalid permissions')) {
          return { ok: false, error: `API key lacks permission. Ensure it has access to base "${baseId}" and table "${tableName}"`, created: false }
        }
        
        return { ok: false, error: errorMsg, created: false }
      }
      
      return { ok: true, id: recordId, created: false }
    } else {
      // Create new record
      // Get phone field name from env (defaults to "phone number")
      const phoneFieldName = process.env.AIRTABLE_PHONE_FIELD || 'phone number'
      const createFields = {
        [phoneFieldName]: normalizedPhone,
        ...fields
      }
      
      const createUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
      console.log(`[Airtable] Creating record at: ${createUrl}`)
      console.log(`[Airtable] Fields to create:`, Object.keys(createFields).join(', '))
      
      const trimmedApiKey = apiKey.trim()
      
      const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${trimmedApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records: [{ fields: createFields }] })
      })
      
      const createData = await createRes.json()
      
      if (!createRes.ok) {
        console.error('[Airtable] Create error:', createData?.error || createData)
        console.error('[Airtable] Create URL:', createUrl)
        console.error('[Airtable] Table name used:', tableName)
        const errorMsg = createData?.error?.message || createData?.error?.type || 'Airtable create failed'
        
        // Provide helpful error messages
        if (errorMsg.includes('Could not find') || errorMsg.includes('not found') || createData?.error?.type === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND') {
          return { ok: false, error: `Table "${tableName}" not found. Check table name matches exactly (case-sensitive). Current: "${tableName}"`, created: true }
        } else if (errorMsg.includes('Invalid permissions')) {
          return { ok: false, error: `API key lacks permission. Ensure it has access to base "${baseId}" and table "${tableName}"`, created: true }
        } else if (errorMsg.includes('Unknown field') || createData?.error?.type === 'UNKNOWN_FIELD_NAME') {
          const unknownFields: string[] = []
          if (createData?.error?.message) {
            // Extract field names from error message like "Unknown field name: 'field1' and 'field2'"
            const matches = createData.error.message.match(/'([^']+)'/g)
            if (matches) {
              unknownFields.push(...matches.map((m: string) => m.replace(/'/g, '')))
            }
          }
          
          const fieldList = unknownFields.length > 0 
            ? unknownFields.join(', ')
            : Object.keys(createFields).join(', ')
          
          console.error(`[Airtable] ❌ Fields do not exist in Airtable table: ${fieldList}`)
          console.error(`[Airtable] These fields should have been created when the poll was sent.`)
          console.error(`[Airtable] Possible causes:`)
          console.error(`[Airtable]   1. AIRTABLE_TABLE_ID not set in environment variables`)
          console.error(`[Airtable]   2. Metadata API field creation failed when poll was sent`)
          console.error(`[Airtable]   3. Fields need to be created manually in Airtable`)
          
          return { ok: false, error: `Fields do not exist: ${fieldList}. These should have been created when the poll was sent. Check AIRTABLE_TABLE_ID is set and field creation succeeded.`, created: true }
        }
        
        return { ok: false, error: errorMsg, created: true }
      }
      
      const id = createData?.records?.[0]?.id
      return { ok: true, id, created: true }
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Airtable request failed', created: false }
  }
}

/**
 * Create Airtable fields via Metadata API
 * Uses Airtable Metadata API to programmatically create fields
 * Reference: https://airtable.com/developers/web/api/create-field
 */
export async function createAirtableFields(
  baseId: string,
  tableId: string,
  fieldNames: { question: string; response: string; notes: string },
  apiKey: string
): Promise<{ ok: boolean; created: string[]; errors: string[]; existing: string[] }> {
  const created: string[] = []
  const errors: string[] = []
  const existing: string[] = []
  
  try {
    const trimmedApiKey = apiKey.trim()
    
    // Validate PAT format
    if (!trimmedApiKey || trimmedApiKey.length < 30) {
      console.error(`[Airtable] ❌ Invalid PAT: Token is too short or missing`)
      return { ok: false, created, errors: [`Invalid PAT: Token must be at least 30 characters`], existing }
    }
    
    if (!trimmedApiKey.toLowerCase().startsWith('pat')) {
      console.warn(`[Airtable] ⚠️ PAT doesn't start with "pat" - may not be a Personal Access Token`)
      console.warn(`[Airtable] Expected format: pat... (Personal Access Token)`)
      console.warn(`[Airtable] Current token preview: ${trimmedApiKey.substring(0, 10)}...`)
    } else {
      console.log(`[Airtable] ✓ PAT format valid (starts with "pat", length: ${trimmedApiKey.length})`)
    }
    
    // Step 0: First, list all accessible bases to verify PAT works at all
    console.log(`[Airtable] Step 0: Testing PAT authentication by listing accessible bases...`)
    const listBasesUrl = `https://api.airtable.com/v0/meta/bases`
    const listBasesRes = await fetch(listBasesUrl, {
      headers: {
        'Authorization': `Bearer ${trimmedApiKey}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (listBasesRes.ok) {
      const basesData = await listBasesRes.json()
      const bases = basesData?.bases || []
      console.log(`[Airtable] ✓ PAT authentication works! Found ${bases.length} accessible base(s)`)
      
      // Check if our target base is in the list
      const targetBase = bases.find((b: any) => b.id === baseId)
      if (targetBase) {
        console.log(`[Airtable] ✓ Target base "${baseId}" found in accessible bases`)
        console.log(`[Airtable]   Base name: ${targetBase.name || 'Unknown'}`)
        
        // Try to get tables list from base (if available in listing response)
        if (targetBase.tables && targetBase.tables.length > 0) {
          console.log(`[Airtable]   Found ${targetBase.tables.length} table(s) in base listing`)
          const targetTable = targetBase.tables.find((t: any) => t.id === tableId)
          if (targetTable) {
            console.log(`[Airtable] ✓ Target table "${tableId}" found in base listing`)
            console.log(`[Airtable]   Table name: ${targetTable.name || 'Unknown'}`)
          } else {
            console.warn(`[Airtable] ⚠️ Target table "${tableId}" not found in base listing`)
          }
        }
      } else {
        console.error(`[Airtable] ❌ Target base "${baseId}" NOT found in accessible bases`)
        console.error(`[Airtable] This means the PAT doesn't have access to this base`)
        console.error(`[Airtable] Available bases:`)
        bases.forEach((b: any, i: number) => {
          console.error(`[Airtable]   ${i + 1}. ${b.name} (${b.id})`)
        })
        console.error(`[Airtable] SOLUTION:`)
        console.error(`[Airtable]   1. Go to https://airtable.com/create/tokens`)
        console.error(`[Airtable]   2. Edit your PAT`)
        console.error(`[Airtable]   3. Under "Access", add base "${baseId}" or enable "All current and future bases"`)
        console.error(`[Airtable]   4. Save and update AIRTABLE_API_KEY in Vercel`)
        
        return { 
          ok: false, 
          created, 
          errors: [`PAT cannot access base "${baseId}". Base not found in accessible bases list. Add base access in PAT settings.`], 
          existing 
        }
      }
    } else {
      const listBasesError = await listBasesRes.json().catch(() => ({}))
      console.error(`[Airtable] ❌ PAT authentication failed: ${listBasesError?.error?.message || `HTTP ${listBasesRes.status}`}`)
      console.error(`[Airtable] This means the PAT itself is invalid or doesn't have required scopes`)
      console.error(`[Airtable] SOLUTION:`)
      console.error(`[Airtable]   1. Verify PAT is correct in Vercel`)
      console.error(`[Airtable]   2. Check PAT has scope: schema.bases:read`)
      console.error(`[Airtable]   3. Create a fresh PAT with all required scopes`)
      
      return { 
        ok: false, 
        created, 
        errors: [`PAT authentication failed: ${listBasesError?.error?.message || `HTTP ${listBasesRes.status}`}. Verify PAT is correct and has schema.bases:read scope.`], 
        existing 
      }
    }
    
    // Step 1: List tables for this base (CORRECT endpoint sequence)
    // The endpoint /v0/meta/bases/{baseId} doesn't exist - we need to list tables instead
    const tablesUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`
    console.log(`[Airtable] Step 1: Listing tables for base ${baseId}...`)
    console.log(`[Airtable] Using correct endpoint: ${tablesUrl}`)
    
    const tablesRes = await fetch(tablesUrl, {
      headers: {
        'Authorization': `Bearer ${trimmedApiKey}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!tablesRes.ok) {
      let tablesErrorData: any = {}
      try {
        tablesErrorData = await tablesRes.json()
      } catch (e) {
        // Response wasn't JSON
      }
      
      const tablesErrorMsg = tablesErrorData?.error?.message || tablesErrorData?.error?.type || `HTTP ${tablesRes.status}`
      const tablesStatus = tablesRes.status
      
      console.error(`[Airtable] ❌ Failed to list tables: ${tablesErrorMsg} (HTTP ${tablesStatus})`)
      console.error(`[Airtable] This means we can't access base tables via Metadata API`)
      console.error(`[Airtable] SOLUTION:`)
      console.error(`[Airtable]   1. Verify base ID is correct: ${baseId}`)
      console.error(`[Airtable]   2. Check PAT has scope: schema.bases:read`)
      console.error(`[Airtable]   3. Verify table ID is correct (get from: ${tablesUrl})`)
      
      return { 
        ok: false, 
        created, 
        errors: [`Failed to list tables for base "${baseId}": ${tablesErrorMsg} (HTTP ${tablesStatus})`], 
        existing 
      }
    }
    
    const tablesData = await tablesRes.json()
    const tables = tablesData?.tables || []
    console.log(`[Airtable] ✓ Step 1 passed: Found ${tables.length} table(s) in base`)
    
    // Verify the target table exists
    const targetTable = tables.find((t: any) => t.id === tableId)
    if (!targetTable) {
      console.error(`[Airtable] ❌ Table ID "${tableId}" not found in base`)
      console.error(`[Airtable] Available tables:`)
      tables.forEach((t: any, i: number) => {
        console.error(`[Airtable]   ${i + 1}. ${t.name} (${t.id})`)
      })
      console.error(`[Airtable] SOLUTION: Update AIRTABLE_TABLE_ID in Vercel with correct table ID`)
      
      return {
        ok: false,
        created,
        errors: [`Table ID "${tableId}" not found in base. Available tables: ${tables.map((t: any) => `${t.name} (${t.id})`).join(', ')}`],
        existing
      }
    }
    
    console.log(`[Airtable] ✓ Target table found: ${targetTable.name} (${tableId})`)
    
    // Step 2: Check if tables list response includes fields
    // The tables list endpoint might include field information in the response
    const existingFields: string[] = []
    if (targetTable.fields && Array.isArray(targetTable.fields)) {
      existingFields.push(...targetTable.fields.map((f: any) => f.name))
      console.log(`[Airtable] ✓ Found ${existingFields.length} existing fields from tables list`)
    } else {
      console.log(`[Airtable] Note: Tables list doesn't include field info, will check during creation`)
    }
    
    // Step 3: Create fields (CORRECT endpoint: /tables/{tableId}/fields)
    const fieldsUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`
    
    // Create Question field (singleLineText)
    if (!existingFields.includes(fieldNames.question)) {
      try {
        console.log(`[Airtable] Step 3a: Creating field: "${fieldNames.question}" (singleLineText)`)
        console.log(`[Airtable] Using endpoint: ${fieldsUrl}`)
        const createRes = await fetch(fieldsUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${trimmedApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: fieldNames.question,
            type: 'singleLineText'
          })
        })
        
        const responseData = await createRes.json()
        
        if (createRes.ok) {
          created.push(fieldNames.question)
          console.log(`[Airtable] ✓ Created field: "${fieldNames.question}"`)
        } else {
          const errorMsg = responseData?.error?.message || responseData?.error?.type || `HTTP ${createRes.status}`
          console.error(`[Airtable] Full error response:`, JSON.stringify(responseData, null, 2))
          // If field already exists (duplicate name error), treat as existing
          if (errorMsg.toLowerCase().includes('already exists') || 
              errorMsg.toLowerCase().includes('duplicate') ||
              responseData?.error?.type === 'DUPLICATE_FIELD_NAME') {
            existing.push(fieldNames.question)
            console.log(`[Airtable] Field "${fieldNames.question}" already exists (detected during creation)`)
          } else {
            console.error(`[Airtable] Failed to create "${fieldNames.question}":`, errorMsg)
            errors.push(`${fieldNames.question}: ${errorMsg}`)
          }
        }
      } catch (err: any) {
        console.error(`[Airtable] Exception creating "${fieldNames.question}":`, err.message)
        errors.push(`${fieldNames.question}: ${err.message}`)
      }
    } else {
      existing.push(fieldNames.question)
      console.log(`[Airtable] Field "${fieldNames.question}" already exists`)
    }
    
    // Create Response field (singleSelect with Yes/No/Maybe options)
    if (!existingFields.includes(fieldNames.response)) {
      try {
        console.log(`[Airtable] Step 3b: Creating field: "${fieldNames.response}" (singleSelect: Yes, No, Maybe)`)
        const createRes = await fetch(fieldsUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${trimmedApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: fieldNames.response,
            type: 'singleSelect',
            options: {
              choices: [
                { name: 'Yes' },
                { name: 'No' },
                { name: 'Maybe' }
              ]
            }
          })
        })
        
        const responseData = await createRes.json()
        
        if (createRes.ok) {
          created.push(fieldNames.response)
          console.log(`[Airtable] ✓ Created field: "${fieldNames.response}"`)
        } else {
          const errorMsg = responseData?.error?.message || responseData?.error?.type || `HTTP ${createRes.status}`
          console.error(`[Airtable] Full error response:`, JSON.stringify(responseData, null, 2))
          // If field already exists (duplicate name error), treat as existing
          if (errorMsg.toLowerCase().includes('already exists') || 
              errorMsg.toLowerCase().includes('duplicate') ||
              responseData?.error?.type === 'DUPLICATE_FIELD_NAME') {
            existing.push(fieldNames.response)
            console.log(`[Airtable] Field "${fieldNames.response}" already exists (detected during creation)`)
          } else {
            console.error(`[Airtable] Failed to create "${fieldNames.response}":`, errorMsg)
            errors.push(`${fieldNames.response}: ${errorMsg}`)
          }
        }
      } catch (err: any) {
        console.error(`[Airtable] Exception creating "${fieldNames.response}":`, err.message)
        errors.push(`${fieldNames.response}: ${err.message}`)
      }
    } else {
      existing.push(fieldNames.response)
      console.log(`[Airtable] Field "${fieldNames.response}" already exists`)
    }
    
    // Create Notes field (multilineText for longer notes)
    if (!existingFields.includes(fieldNames.notes)) {
      try {
        console.log(`[Airtable] Step 3c: Creating field: "${fieldNames.notes}" (multilineText)`)
        const createRes = await fetch(fieldsUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${trimmedApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: fieldNames.notes,
            type: 'multilineText'
          })
        })
        
        const responseData = await createRes.json()
        
        if (createRes.ok) {
          created.push(fieldNames.notes)
          console.log(`[Airtable] ✓ Created field: "${fieldNames.notes}"`)
        } else {
          const errorMsg = responseData?.error?.message || responseData?.error?.type || `HTTP ${createRes.status}`
          console.error(`[Airtable] Full error response:`, JSON.stringify(responseData, null, 2))
          // If field already exists (duplicate name error), treat as existing
          if (errorMsg.toLowerCase().includes('already exists') || 
              errorMsg.toLowerCase().includes('duplicate') ||
              responseData?.error?.type === 'DUPLICATE_FIELD_NAME') {
            existing.push(fieldNames.notes)
            console.log(`[Airtable] Field "${fieldNames.notes}" already exists (detected during creation)`)
          } else {
            console.error(`[Airtable] Failed to create "${fieldNames.notes}":`, errorMsg)
            errors.push(`${fieldNames.notes}: ${errorMsg}`)
          }
        }
      } catch (err: any) {
        console.error(`[Airtable] Exception creating "${fieldNames.notes}":`, err.message)
        errors.push(`${fieldNames.notes}: ${err.message}`)
      }
    } else {
      existing.push(fieldNames.notes)
      console.log(`[Airtable] Field "${fieldNames.notes}" already exists`)
    }
    
    // Summary
    const totalFields = created.length + existing.length
    console.log(`[Airtable] Field creation summary: ${created.length} created, ${existing.length} already existed, ${errors.length} errors`)
    
    // Success if all 3 fields exist (created now or already existed)
    const allFieldsExist = totalFields === 3
    return { ok: allFieldsExist && errors.length === 0, created, errors, existing }
  } catch (err: any) {
    console.error(`[Airtable] Metadata API failed with exception:`, err)
    return { ok: false, created, errors: [`Metadata API failed: ${err.message}`], existing }
  }
}


