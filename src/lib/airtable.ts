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
    return { ok: false, error: 'Missing AIRTABLE_API_KEY' }
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
              unknownFields.push(...matches.map(m => m.replace(/'/g, '')))
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
    const metaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}`
    
    console.log(`[Airtable] Checking existing fields in table ${tableId}...`)
    console.log(`[Airtable] Metadata API URL: ${metaUrl}`)
    console.log(`[Airtable] Base ID: ${baseId}`)
    console.log(`[Airtable] Table ID: ${tableId}`)
    
    // First, check if fields already exist and get table schema
    const metaRes = await fetch(metaUrl, {
      headers: {
        'Authorization': `Bearer ${trimmedApiKey}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!metaRes.ok) {
      let errorData: any = {}
      try {
        errorData = await metaRes.json()
      } catch (e) {
        // Response wasn't JSON, use status code
      }
      
      const errorMsg = errorData?.error?.message || errorData?.error?.type || `HTTP ${metaRes.status}`
      const status = metaRes.status
      
      console.error(`[Airtable] ❌ Failed to fetch table schema: ${errorMsg}`)
      console.error(`[Airtable] HTTP Status: ${status}`)
      
      if (status === 404) {
        console.error(`[Airtable] 404 Error - Table not found. Possible causes:`)
        console.error(`[Airtable]   1. Table ID "${tableId}" doesn't exist in base "${baseId}"`)
        console.error(`[Airtable]   2. Check table ID in Airtable URL: https://airtable.com/${baseId}/${tableId}/...`)
        console.error(`[Airtable]   3. Verify the table ID is correct (should start with "tbl" and be in the URL)`)
        console.error(`[Airtable]   4. PAT may not have access to this base/table`)
        console.error(`[Airtable]   5. Verify PAT has scope: schema.bases:read`)
        console.error(`[Airtable]   6. Check if PAT has access to base "${baseId}"`)
        console.error(`[Airtable]   📋 HOW TO FIND TABLE ID:`)
        console.error(`[Airtable]      - Go to your Airtable table`)
        console.error(`[Airtable]      - Look at URL: https://airtable.com/appXXXXXX/tblYYYYYYYY/...`)
        console.error(`[Airtable]      - The "tblYYYYYYYY" part is your Table ID`)
      } else if (status === 401 || status === 403) {
        console.error(`[Airtable] Authentication/Permission Error:`)
        console.error(`[Airtable]   1. Check PAT is valid and not expired`)
        console.error(`[Airtable]   2. Verify PAT has scope: schema.bases:read`)
        console.error(`[Airtable]   3. Check PAT has access to base "${baseId}"`)
      }
      
      return { ok: false, created, errors: [`Failed to access Metadata API: ${errorMsg} (HTTP ${status})`], existing }
    }
    
    const metaData = await metaRes.json()
    const existingFields = metaData?.schema?.fields?.map((f: any) => f.name) || []
    console.log(`[Airtable] Found ${existingFields.length} existing fields in table`)
    
    // Create Question field (singleLineText)
    if (!existingFields.includes(fieldNames.question)) {
      try {
        console.log(`[Airtable] Creating field: "${fieldNames.question}" (singleLineText)`)
        const createRes = await fetch(`${metaUrl}/fields`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${trimmedApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: [{
              name: fieldNames.question,
              type: 'singleLineText'
            }]
          })
        })
        
        const responseData = await createRes.json()
        
        if (createRes.ok) {
          created.push(fieldNames.question)
          console.log(`[Airtable] ✓ Created field: "${fieldNames.question}"`)
        } else {
          const errorMsg = responseData?.error?.message || responseData?.error?.type || `HTTP ${createRes.status}`
          console.error(`[Airtable] Failed to create "${fieldNames.question}":`, errorMsg)
          errors.push(`${fieldNames.question}: ${errorMsg}`)
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
        console.log(`[Airtable] Creating field: "${fieldNames.response}" (singleSelect: Yes, No, Maybe)`)
        const createRes = await fetch(`${metaUrl}/fields`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${trimmedApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: [{
              name: fieldNames.response,
              type: 'singleSelect',
              options: {
                choices: [
                  { name: 'Yes' },
                  { name: 'No' },
                  { name: 'Maybe' }
                ]
              }
            }]
          })
        })
        
        const responseData = await createRes.json()
        
        if (createRes.ok) {
          created.push(fieldNames.response)
          console.log(`[Airtable] ✓ Created field: "${fieldNames.response}"`)
        } else {
          const errorMsg = responseData?.error?.message || responseData?.error?.type || `HTTP ${createRes.status}`
          console.error(`[Airtable] Failed to create "${fieldNames.response}":`, errorMsg)
          errors.push(`${fieldNames.response}: ${errorMsg}`)
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
        console.log(`[Airtable] Creating field: "${fieldNames.notes}" (multilineText)`)
        const createRes = await fetch(`${metaUrl}/fields`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${trimmedApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: [{
              name: fieldNames.notes,
              type: 'multilineText'
            }]
          })
        })
        
        const responseData = await createRes.json()
        
        if (createRes.ok) {
          created.push(fieldNames.notes)
          console.log(`[Airtable] ✓ Created field: "${fieldNames.notes}"`)
        } else {
          const errorMsg = responseData?.error?.message || responseData?.error?.type || `HTTP ${createRes.status}`
          console.error(`[Airtable] Failed to create "${fieldNames.notes}":`, errorMsg)
          errors.push(`${fieldNames.notes}: ${errorMsg}`)
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


