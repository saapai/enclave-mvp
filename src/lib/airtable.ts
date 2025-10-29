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
    console.error(`[Airtable] API key is too short (${keyLength} chars). Personal Access Tokens are typically 40-60 characters long.`)
    console.error(`[Airtable] The token appears to be incomplete. Please check your Vercel environment variable.`)
  }
  
  // Validate token format (should start with 'pat_' for PAT - lowercase)
  if (!apiKey.startsWith('pat_')) {
    console.warn('[Airtable] API key does not start with "pat_" (lowercase) - may be using old API key instead of Personal Access Token')
    console.warn(`[Airtable] First 20 chars of key: "${apiKey.substring(0, 20)}"`)
    console.warn(`[Airtable] Expected format: "pat_" followed by 40+ characters`)
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
        } else if (errorMsg.includes('Unknown field')) {
          return { ok: false, error: `Field "${Object.keys(createFields)[0]}" not found. Check field names match exactly.`, created: true }
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
 */
export async function createAirtableFields(
  baseId: string,
  tableId: string,
  fieldNames: { question: string; response: string; notes: string },
  apiKey: string
): Promise<{ ok: boolean; created: string[]; errors: string[] }> {
  const created: string[] = []
  const errors: string[] = []
  
  try {
    // First, check if fields already exist
    const metaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}`
    const trimmedApiKey = apiKey.trim()
    
    const metaRes = await fetch(metaUrl, {
      headers: {
        'Authorization': `Bearer ${trimmedApiKey}`,
        'Content-Type': 'application/json'
      }
    })
    
    const metaData = await metaRes.json()
    const existingFields = metaData?.schema?.fields?.map((f: any) => f.name) || []
    
    // Create Question field
    if (!existingFields.includes(fieldNames.question)) {
      try {
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
        
        if (createRes.ok) {
          created.push(fieldNames.question)
        } else {
          const errorData = await createRes.json()
          errors.push(`${fieldNames.question}: ${errorData?.error?.message || 'Unknown error'}`)
        }
      } catch (err: any) {
        errors.push(`${fieldNames.question}: ${err.message}`)
      }
    } else {
      console.log(`[Airtable] Field "${fieldNames.question}" already exists`)
    }
    
    // Create Response field (single select)
    if (!existingFields.includes(fieldNames.response)) {
      try {
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
        
        if (createRes.ok) {
          created.push(fieldNames.response)
        } else {
          const errorData = await createRes.json()
          errors.push(`${fieldNames.response}: ${errorData?.error?.message || 'Unknown error'}`)
        }
      } catch (err: any) {
        errors.push(`${fieldNames.response}: ${err.message}`)
      }
    } else {
      console.log(`[Airtable] Field "${fieldNames.response}" already exists`)
    }
    
    // Create Notes field
    if (!existingFields.includes(fieldNames.notes)) {
      try {
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
        
        if (createRes.ok) {
          created.push(fieldNames.notes)
        } else {
          const errorData = await createRes.json()
          errors.push(`${fieldNames.notes}: ${errorData?.error?.message || 'Unknown error'}`)
        }
      } catch (err: any) {
        errors.push(`${fieldNames.notes}: ${err.message}`)
      }
    } else {
      console.log(`[Airtable] Field "${fieldNames.notes}" already exists`)
    }
    
    return { ok: errors.length === 0, created, errors }
  } catch (err: any) {
    return { ok: false, created, errors: [`Metadata API check failed: ${err.message}`] }
  }
}


