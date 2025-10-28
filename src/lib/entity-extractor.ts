/**
 * Entity Extraction Pipeline
 * Extracts structured entities (events, policies, people) from text using LLM + regex
 */

import { ENV } from './env'
import {
  Event,
  Policy,
  Person,
  upsertEvent,
  upsertPolicy,
  upsertPerson,
  addEventAlias,
  createLinkback,
  normalizeEventSlug,
  parseDateTime,
  extractLocation
} from './knowledge-graph'

// ============================================================================
// TYPES
// ============================================================================

export interface ExtractedEntity {
  type: 'event' | 'policy' | 'person'
  confidence: number
  data: Partial<Event> | Partial<Policy> | Partial<Person>
  aliases?: string[]
  sourceRef: {
    sourceType: string
    sourceId: string
    chunkId?: string
    startOffset?: number
    endOffset?: number
  }
}

export interface ExtractionResult {
  entities: ExtractedEntity[]
  rawResponse?: string
}

// ============================================================================
// LLM-BASED EXTRACTION
// ============================================================================

/**
 * Extract entities from text using Mistral AI
 */
export async function extractEntitiesFromText(
  text: string,
  sourceType: string,
  sourceId: string,
  spaceId: string
): Promise<ExtractionResult> {
  if (!ENV.MISTRAL_API_KEY) {
    console.error('[Entity Extractor] MISTRAL_API_KEY not set')
    return { entities: [] }
  }

  const systemPrompt = `You are an entity extraction specialist. Extract structured information from text.

EXTRACT:
1. Events: name, date/time, location, hosts, required attendance
2. Policies: title, summary, audience, category
3. People: name, role, email, organization

RULES:
- Only extract if confidence > 0.7
- Return JSON array of entities
- Include alternative names as aliases
- Be precise with dates/times

FORMAT:
{
  "entities": [
    {
      "type": "event",
      "confidence": 0.95,
      "data": {
        "name": "Active Meeting",
        "start_at": "2025-11-06T20:00:00Z",
        "location": "Mahi's apartment (461B Kelton)",
        "hosts": ["Mahi"],
        "required": true
      },
      "aliases": ["active mtg", "actives meeting"]
    }
  ]
}`

  const userPrompt = `Extract entities from this text:

${text.substring(0, 4000)}

Return JSON only.`

  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENV.MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.error('[Entity Extractor] API error:', response.status)
      return { entities: [] }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return { entities: [] }
    }

    const parsed = JSON.parse(content)
    const entities: ExtractedEntity[] = (parsed.entities || []).map((e: any) => ({
      ...e,
      sourceRef: {
        sourceType,
        sourceId,
        startOffset: 0,
        endOffset: text.length
      }
    }))

    console.log(`[Entity Extractor] Extracted ${entities.length} entities from text`)
    return { entities, rawResponse: content }

  } catch (error) {
    console.error('[Entity Extractor] Error:', error)
    return { entities: [] }
  }
}

// ============================================================================
// REGEX-BASED EXTRACTION (Fast, for common patterns)
// ============================================================================

/**
 * Extract events using regex patterns (faster than LLM)
 */
export function extractEventsRegex(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []

  // Pattern: "Event Name will be on Date at Time at Location"
  const patterns = [
    // "Active Meeting is every Wednesday at 8 PM at Mahi's apartment"
    /([A-Z][A-Za-z\s]+(?:Meeting|Session|Event|Summons|Appreciation))\s+(?:is|are|will be)\s+(?:every\s+)?(\w+day)\s+at\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?\s+(?:at|in|@)\s+([A-Za-z\s']+)/gi,
    
    // "Big Little on November 13th (time TBD)"
    /([A-Z][A-Za-z\s]+)\s+(?:on|will be on)\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)/gi,
    
    // "Study Hall: Wednesdays 6:30-12:30 at Rieber"
    /([A-Z][A-Za-z\s]+):\s+(\w+days?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(?:am|pm)?\s+(?:at|in)\s+([A-Za-z\s]+)/gi
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const eventName = match[1].trim()
      
      // Try to parse date/time from the match
      const dateTime = parseDateTime(match[0])
      const location = extractLocation(match[0])

      entities.push({
        type: 'event',
        confidence: 0.8,
        data: {
          name: eventName,
          series_slug: normalizeEventSlug(eventName),
          start_at: dateTime || undefined,
          location: location || undefined,
          description: match[0]
        },
        sourceRef: {
          sourceType: 'regex',
          sourceId: '',
          startOffset: match.index,
          endOffset: match.index + match[0].length
        }
      })
    }
  }

  return entities
}

/**
 * Extract people using regex patterns
 */
export function extractPeopleRegex(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []

  // Pattern: "Name (Role)" or "Name - Role"
  const patterns = [
    /([A-Z][a-z]+\s+[A-Z][a-z]+)\s+\(([A-Za-z\s]+)\)/g,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)\s+-\s+([A-Za-z\s]+)/g
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim()
      const role = match[2].trim().toLowerCase()

      entities.push({
        type: 'person',
        confidence: 0.7,
        data: {
          name,
          role
        },
        sourceRef: {
          sourceType: 'regex',
          sourceId: '',
          startOffset: match.index,
          endOffset: match.index + match[0].length
        }
      })
    }
  }

  return entities
}

// ============================================================================
// HYBRID EXTRACTION (LLM + Regex)
// ============================================================================

/**
 * Extract entities using both LLM and regex, then merge results
 */
export async function extractEntitiesHybrid(
  text: string,
  sourceType: string,
  sourceId: string,
  spaceId: string
): Promise<ExtractionResult> {
  console.log(`[Entity Extractor] Hybrid extraction for source ${sourceId}`)

  // Fast regex extraction first
  const regexEvents = extractEventsRegex(text)
  const regexPeople = extractPeopleRegex(text)
  
  console.log(`[Entity Extractor] Regex found ${regexEvents.length} events, ${regexPeople.length} people`)

  // LLM extraction for higher precision
  const llmResult = await extractEntitiesFromText(text, sourceType, sourceId, spaceId)
  
  console.log(`[Entity Extractor] LLM found ${llmResult.entities.length} entities`)

  // Merge results (prefer LLM for higher confidence, use regex as fallback)
  const allEntities = [...llmResult.entities, ...regexEvents, ...regexPeople]
  
  // Deduplicate by name (keep highest confidence)
  const deduped = new Map<string, ExtractedEntity>()
  
  for (const entity of allEntities) {
    const key = entity.type + ':' + (entity.data as any).name?.toLowerCase()
    const existing = deduped.get(key)
    
    if (!existing || entity.confidence > existing.confidence) {
      deduped.set(key, entity)
    }
  }

  return {
    entities: Array.from(deduped.values()),
    rawResponse: llmResult.rawResponse
  }
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Save extracted entities to knowledge graph
 */
export async function saveEntitiesToKnowledgeGraph(
  entities: ExtractedEntity[],
  spaceId: string
): Promise<{ saved: number; failed: number }> {
  let saved = 0
  let failed = 0

  for (const entity of entities) {
    try {
      if (entity.type === 'event') {
        const eventData = entity.data as Partial<Event>
        const event = await upsertEvent({
          ...eventData,
          space_id: spaceId,
          source_type: entity.sourceRef.sourceType,
          source_id: entity.sourceRef.sourceId,
          chunk_id: entity.sourceRef.chunkId,
          start_offset: entity.sourceRef.startOffset,
          end_offset: entity.sourceRef.endOffset,
          confidence: entity.confidence
        })

        if (event) {
          // Add aliases
          if (entity.aliases) {
            for (const alias of entity.aliases) {
              await addEventAlias(event.id, alias)
            }
          }

          // Create linkback
          await createLinkback({
            entity_type: 'event',
            entity_id: event.id,
            source_type: entity.sourceRef.sourceType,
            source_id: entity.sourceRef.sourceId,
            chunk_id: entity.sourceRef.chunkId,
            start_offset: entity.sourceRef.startOffset,
            end_offset: entity.sourceRef.endOffset,
            source_title: eventData.name
          })

          saved++
          console.log(`[Entity Extractor] ✓ Saved event: ${eventData.name}`)
        } else {
          failed++
        }
      } else if (entity.type === 'policy') {
        const policyData = entity.data as Partial<Policy>
        const policy = await upsertPolicy({
          ...policyData,
          space_id: spaceId,
          source_type: entity.sourceRef.sourceType,
          source_id: entity.sourceRef.sourceId,
          chunk_id: entity.sourceRef.chunkId,
          start_offset: entity.sourceRef.startOffset,
          end_offset: entity.sourceRef.endOffset,
          confidence: entity.confidence
        })

        if (policy) {
          await createLinkback({
            entity_type: 'policy',
            entity_id: policy.id,
            source_type: entity.sourceRef.sourceType,
            source_id: entity.sourceRef.sourceId,
            chunk_id: entity.sourceRef.chunkId,
            start_offset: entity.sourceRef.startOffset,
            end_offset: entity.sourceRef.endOffset,
            source_title: policyData.title
          })

          saved++
          console.log(`[Entity Extractor] ✓ Saved policy: ${policyData.title}`)
        } else {
          failed++
        }
      } else if (entity.type === 'person') {
        const personData = entity.data as Partial<Person>
        const person = await upsertPerson({
          ...personData,
          space_id: spaceId
        })

        if (person) {
          saved++
          console.log(`[Entity Extractor] ✓ Saved person: ${personData.name}`)
        } else {
          failed++
        }
      }
    } catch (error) {
      console.error(`[Entity Extractor] Error saving entity:`, error)
      failed++
    }
  }

  console.log(`[Entity Extractor] Saved ${saved}/${entities.length} entities (${failed} failed)`)
  return { saved, failed }
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/**
 * Process a resource and extract all entities
 */
export async function processResource(
  resourceId: string,
  resourceBody: string,
  spaceId: string
): Promise<{ saved: number; failed: number }> {
  console.log(`[Entity Extractor] Processing resource ${resourceId}`)

  // Extract entities
  const result = await extractEntitiesHybrid(
    resourceBody,
    'resource',
    resourceId,
    spaceId
  )

  // Save to knowledge graph
  return await saveEntitiesToKnowledgeGraph(result.entities, spaceId)
}

