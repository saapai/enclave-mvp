/**
 * Execute Answer Mode
 * 
 * Handles query answering with hybrid RAG retrieval (V2 - sequential, budget-aware)
 */

import { TurnFrame, ContextEnvelope } from '../types'
import { hybridSearchV2 } from '@/lib/search-v2'
import { getWorkspaceIds, rankWorkspaceIds } from '@/lib/workspace'
import { generateTraceId } from '@/lib/utils'
import { ENV } from '@/lib/env'

// SearchResult type
type SearchResult = Awaited<ReturnType<typeof hybridSearchV2>>[number]

export interface ExecuteResult {
  messages: string[]
  newMode?: 'IDLE' | 'ANNOUNCEMENT_INPUT' | 'POLL_INPUT' | 'CONFIRM_SEND'
}

/**
 * Execute Answer mode - hybrid RAG + compose
 */
export async function executeAnswer(
  frame: TurnFrame,
  envelope: ContextEnvelope
): Promise<ExecuteResult> {
  const traceId = generateTraceId()
  const overallStart = Date.now()
  console.log(`[Execute Answer] [${traceId}] Starting executeAnswer`)
  console.log(`[Execute Answer] [${traceId}] Frame user ID:`, frame.user.id)
  const query = frame.text
  const normalizedQuery = query.toLowerCase().trim()
  const explicitDeadlineMs = Number(process.env.SMS_EXECUTE_DEADLINE_MS || '4000')
  const abortController = new AbortController()
  const deadlineTimer = setTimeout(() => {
    console.warn(`[Execute Answer] [${traceId}] Deadline reached, aborting search pipeline`)
    abortController.abort()
  }, explicitDeadlineMs)
  
  try {
    // Step 1: Get workspace IDs (with 500ms timeout via new workspace.ts)
    const primaryWorkspaceId = ENV.PRIMARY_WORKSPACE_ID?.trim()
    let spaceIds: string[]

    if (primaryWorkspaceId) {
      console.log(`[Execute Answer] [${traceId}] Using PRIMARY_WORKSPACE_ID override: ${primaryWorkspaceId}`)
      spaceIds = [primaryWorkspaceId]
    } else {
      const workspaceStart = Date.now()
      console.log(`[Execute Answer] [${traceId}] About to call getWorkspaceIds`)
      spaceIds = await getWorkspaceIds({
        phoneNumber: frame.user.id,
        includeSepFallback: true,
        includePhoneLookup: false
      })
      const workspaceDuration = Date.now() - workspaceStart
      console.log(`[Execute Answer] [${traceId}] Retrieved ${spaceIds.length} workspace ids in ${workspaceDuration}ms`)
      console.log(`[Execute Answer] [${traceId}] Workspace IDs:`, spaceIds)
    }
    
    // Filter out default workspace
    const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'
    const realSpaces = spaceIds.filter(id => id && id !== DEFAULT_SPACE_ID)
    
    // Prioritize SEP workspace if env var is set
    const SEP_SPACE_ID = process.env.SEP_SPACE_ID
    const prioritizedSpaces = primaryWorkspaceId
      ? realSpaces
      : SEP_SPACE_ID && realSpaces.includes(SEP_SPACE_ID)
        ? [SEP_SPACE_ID, ...realSpaces.filter(id => id !== SEP_SPACE_ID)]
        : realSpaces
    
    // Hard cap at 4 workspaces for SMS (all 4 UCLA SEP workspaces)
    const workspaceIds = primaryWorkspaceId
      ? prioritizedSpaces
      : prioritizedSpaces.slice(0, 4)
    
    let orderedWorkspaceIds = workspaceIds
    if (!primaryWorkspaceId) {
      try {
        const ranked = await rankWorkspaceIds(workspaceIds)
        if (ranked.length === workspaceIds.length) {
          orderedWorkspaceIds = ranked
        }
      } catch (err) {
        console.error(`[Execute Answer] [${traceId}] Failed to rank workspaces:`, err)
      }
    }
    
    console.log(`[Execute Answer] [${traceId}] Filtered workspaces: ${spaceIds.length} -> ${workspaceIds.length}`)
    console.log(`[Execute Answer] [${traceId}] Search order: ${orderedWorkspaceIds.join(', ')}`)
    
    const finalWorkspaceIds = orderedWorkspaceIds
    
    // Early exit if no real workspaces
    if (workspaceIds.length === 0) {
      console.warn(`[Execute Answer] [${traceId}] No real workspaces found, returning early`)
      return {
        messages: ["No workspace is linked yet. Link SEP or specify a space."]
      }
    }
    
    // Step 2: Hybrid search (V2 - sequential, budget-aware)
    const searchStart = Date.now()
    const searchBudget = 8000 // 8s budget for search (OpenAI embeddings are fast ~200-500ms)
    
    console.log(`[Execute Answer] [${traceId}] Starting hybrid search V2 (budget: ${searchBudget}ms)`)
    const searchResults = await hybridSearchV2(query, finalWorkspaceIds, {
      budgetMs: searchBudget,
      highConfidenceThreshold: 0.75,
      abortSignal: abortController.signal,
      traceId
    })
    
    const searchDuration = Date.now() - searchStart
    console.log(`[Execute Answer] [${traceId}] Search completed in ${searchDuration}ms, found ${searchResults.length} results`)
    
    if (searchResults.length > 0) {
      console.log(`[Execute Answer] [${traceId}] Top result: "${searchResults[0].title}" (score: ${searchResults[0].score?.toFixed(3)})`)
    }

    const structuredAnswer = selectEventAnswer(searchResults, query, traceId)
    if (structuredAnswer) {
      clearTimeout(deadlineTimer)
      return {
        messages: [structuredAnswer]
      }
    }

    // Step 3: If we have good results, compose response directly
    if (searchResults.length > 0 && searchResults[0].score && searchResults[0].score >= 0.60) {
      console.log(`[Execute Answer] [${traceId}] Good results found, composing response directly`)
      const topResults = searchResults.slice(0, 3)
      return await composeDirectResponse(query, topResults, traceId)
    }
    
    // Step 4: If no good results, return helpful message
    if (searchResults.length === 0) {
      console.log(`[Execute Answer] [${traceId}] No results found`)
      return {
        messages: [`I couldn't find anything about "${query}" in your workspaces. Try rephrasing or check if the document is uploaded.`]
      }
    }
    
    // Step 5: Low-confidence results - try to compose something useful
    console.log(`[Execute Answer] [${traceId}] Low-confidence results, attempting composition`)
    const fallbackResults = searchResults.slice(0, 3)
    return await composeDirectResponse(query, fallbackResults, traceId)
    
  } catch (error) {
    console.error(`[Execute Answer] [${traceId}] Error:`, error)
    return {
      messages: ["Sorry, I ran into an issue searching for that. Please try again."]
    }
  } finally {
    clearTimeout(deadlineTimer)
    const totalDuration = Date.now() - overallStart
    console.log(`[Execute Answer] [${traceId}] Completed in ${totalDuration}ms`)
  }
}

/**
 * Compose a direct response using LLM (Mistral API)
 */
async function composeDirectResponse(
  query: string,
  results: SearchResult[],
  traceId: string
): Promise<ExecuteResult> {
  console.log(`[Execute Answer] [${traceId}] Composing direct response`)
  
  if (!results || results.length === 0) {
    return {
      messages: ["I found some results but couldn't extract useful information. Try rephrasing your question or check if the document is uploaded."]
    }
  }
  
  try {
    const keywordSet = Array.from(
      new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((token) => token.length >= 3)
      )
    )

    type GenericRecord = Record<string, unknown>

    const textFieldOrder: string[] = [
      'highlight',
      'snippet',
      'body',
      'content',
      'chunk_body',
      'chunk_text',
      'text',
      'summary',
      'description',
      'notes'
    ]

    const collectStringValues = (value: unknown, depth = 0): string[] => {
      if (typeof value === 'string') {
        return [value.trim()]
      }
      if (!value || depth > 2) {
        return []
      }
      if (Array.isArray(value)) {
        return value.flatMap((item) => collectStringValues(item, depth + 1))
      }
      if (typeof value === 'object') {
        return Object.values(value as GenericRecord).flatMap((item) => collectStringValues(item, depth + 1))
      }
      return []
    }

    const extractSnippet = (result: SearchResult): string => {
      const candidateTexts: string[] = []

      for (const field of textFieldOrder) {
        const value = (result as GenericRecord)[field as string]
        if (value) {
          candidateTexts.push(...collectStringValues(value))
        }
      }

      for (const [key, value] of Object.entries(result as GenericRecord)) {
        if (textFieldOrder.includes(key)) continue
        candidateTexts.push(...collectStringValues(value))
      }

      const normalizedCandidates = candidateTexts
        .map((text) => text.replace(/\s+/g, ' ').trim())
        .filter((text) => text.length > 0)

      if (normalizedCandidates.length === 0) {
        return ''
      }

      type SegmentScore = {
        text: string
        hits: number
        length: number
      }

      const scoreSegment = (segmentText: string): SegmentScore | null => {
        const trimmed = segmentText.trim()
        if (!trimmed) return null
        const lower = trimmed.toLowerCase()
        const hits = keywordSet.reduce((acc, keyword) => (lower.includes(keyword) ? acc + 1 : acc), 0)
        return {
          text: trimmed,
          hits,
          length: trimmed.length
        }
      }

      const segments: SegmentScore[] = []
      for (const candidate of normalizedCandidates) {
        const parts = candidate.split(/(?<=[\.\!\?\n])\s+/)
        if (parts.length === 0) {
          const scored = scoreSegment(candidate.slice(0, 320))
          if (scored) segments.push(scored)
          continue
        }
        for (const part of parts) {
          const scored = scoreSegment(part)
          if (scored) segments.push(scored)
        }
      }

      if (segments.length === 0) {
        return normalizedCandidates[0].slice(0, 320)
      }

      segments.sort((a, b) => {
        if (b.hits !== a.hits) return b.hits - a.hits
        return b.length - a.length
      })

      const primary = segments[0]
      if (!primary) {
        return normalizedCandidates[0].slice(0, 320)
      }

      let snippet = primary.text
      if (snippet.length < 220) {
        for (const segment of segments.slice(1)) {
          if (segment.text === primary.text) continue
          snippet += ` ${segment.text}`
          if (snippet.length >= 220 || segment.hits > 0) {
            break
          }
        }
      }

      return snippet.slice(0, 450)
    }

    const contextBlocks = results.map((result, index) => {
      const snippet = extractSnippet(result)
      const safeSnippet = snippet.length > 0 ? snippet : '[No relevant excerpt found in this result]'

      const metadataParts: string[] = []
      metadataParts.push(`Result ${index + 1}: ${result.title || 'Untitled resource'}`)
      if (typeof result.score === 'number') {
        metadataParts.push(`Score: ${result.score.toFixed(3)}`)
      }
      if (typeof result.source === 'string') {
        metadataParts.push(`Source: ${result.source}`)
      }

      const metadata = (result as GenericRecord).metadata as GenericRecord | undefined
      if (metadata) {
        const dateFields = ['event_date', 'date', 'start_date', 'start_time', 'location']
        for (const field of dateFields) {
          const value = metadata[field]
          if (typeof value === 'string' && value.trim().length > 0) {
            metadataParts.push(`${field.replace(/_/g, ' ')}: ${value}`)
          }
        }
      }

      if (typeof (result as GenericRecord).path === 'string') {
        metadataParts.push(`Path: ${(result as GenericRecord).path}`)
      } else if (typeof (result as GenericRecord).url === 'string') {
        metadataParts.push(`URL: ${(result as GenericRecord).url}`)
      }

      return `${metadataParts.join(' | ')}\n${safeSnippet}`
    })
    
    const combinedContext = contextBlocks.join('\n\n')
    const maxContextLength = 2500
    const truncatedContext = combinedContext.length > maxContextLength
      ? combinedContext.substring(0, maxContextLength) + '...'
      : combinedContext
    
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENV.MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant answering questions for a sorority/fraternity operations team. Use ONLY the provided search results to answer. If any result mentions a date, time, or definition relevant to the question, surface it directly. If the context lacks the answer, say so explicitly and suggest the closest relevant details you do see.'
          },
          {
            role: 'user',
            content: `Search Results:\n${truncatedContext}\n\nQuestion: ${query}\n\nRespond with the answer using the evidence above. Quote or reference the relevant result (e.g., "Result 1") when possible. If the answer truly is not present, state that clearly.`
          }
        ],
        temperature: 0.2,
        max_tokens: 220
      })
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Execute Answer] [${traceId}] Mistral API error:`, response.status, errorText)
      return {
        messages: ["I found some information but couldn't process it properly. Please try again."]
      }
    }
    
    const data = await response.json()
    const answer = data.choices?.[0]?.message?.content?.trim()
    
    if (!answer) {
      console.error(`[Execute Answer] [${traceId}] LLM returned empty response`)
      return {
        messages: ["I found some information but couldn't formulate a good answer. Try asking differently."]
      }
    }
    
    let trimmedAnswer = answer.length > 0 ? answer : 'I located context but could not format a response in time.'
    const needsTemporalPrecision = /\bwhen\b|date|time/.test(query.toLowerCase())
    const hasTemporalPrecision = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\b\d{1,2}(st|nd|rd|th)?\b|\b\d{1,2}:\d{2}\b|\b(am|pm)\b)/i.test(trimmedAnswer)
    if (needsTemporalPrecision && !hasTemporalPrecision) {
      trimmedAnswer += '\n\nI didn\'t see a specific date or time in the docs—double-check with exec before announcing.'
    }
    console.log(`[Execute Answer] [${traceId}] Composed response: "${trimmedAnswer.substring(0, 100)}..."`)
    return {
      messages: [trimmedAnswer]
    }
    
  } catch (err) {
    console.error(`[Execute Answer] [${traceId}] Error composing response:`, err)
    return {
      messages: ["I found some information but couldn't process it properly. Please try again."]
    }
  }
}

interface EventFields {
  title?: string
  date?: string
  weeklyRule?: string
  time?: string
  location?: string
  context?: string
}

function selectEventAnswer(results: SearchResult[], query: string, traceId: string): string | null {
  for (const result of results.slice(0, 10)) {
    const fields = extractEventFields(result)
    if (isAnswerable(fields)) {
      const message = formatEventAnswer(fields, query)
      console.log(`[Execute Answer] [${traceId}] Structured answer from result`, {
        resultTitle: result.title,
        date: fields.date,
        weeklyRule: fields.weeklyRule,
        time: fields.time,
        location: fields.location
      })
      return message
    }
  }
  if (results.length > 0) {
    console.log(`[Execute Answer] [${traceId}] Structured extraction missed; showing top candidates`,
      results.slice(0, 5).map((hit) => ({
        title: hit.title,
        score: hit.score,
        source: (hit as any)?.source,
        hasDate: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}(st|nd|rd|th)?)\b/i.test(`${hit.title} ${(hit as any)?.body || ''}`)
      }))
    )
  }
  return null
}

function extractEventFields(result: SearchResult): EventFields {
  const fields: EventFields = {}
  const textParts: string[] = []
  const title = (result as any)?.title as string | undefined
  if (title) {
    fields.title = title
    textParts.push(title)
  }
  const possibleFields = ['subtitle', 'summary', 'content', 'body', 'description', 'preview', 'snippet', 'text']
  for (const key of possibleFields) {
    const value = (result as any)?.[key]
    if (typeof value === 'string') {
      textParts.push(value)
    }
  }
  const combined = textParts.join(' ').replace(/\s+/g, ' ').trim()
  fields.context = combined

  const dateRegex = /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(\s+\d{1,2}(st|nd|rd|th)?)/i
  const weeklyRegex = /\b(every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|weekday|weekend)s?\b/i
  const timeRegex = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i
  const locationRegex = /\b(?:at|@)\s+([^\.,;]+)/i

  const dateMatch = combined.match(dateRegex)
  const weeklyMatch = combined.match(weeklyRegex)
  const timeMatch = combined.match(timeRegex)
  const locationMatch = combined.match(locationRegex)

  if (dateMatch) {
    fields.date = dateMatch[0].replace(/\s+/g, ' ').trim()
  }
  if (weeklyMatch) {
    fields.weeklyRule = weeklyMatch[0].replace(/\s+/g, ' ').trim()
  }
  if (timeMatch) {
    fields.time = timeMatch[0].toUpperCase()
  }
  if (locationMatch) {
    const location = locationMatch[1].trim()
    if (location.length > 0) {
      fields.location = location
    }
  } else {
    const venueKeywords = ['kelton', 'levering', 'sac', 'apartment', 'terrace', 'lounge']
    for (const keyword of venueKeywords) {
      const match = combined.match(new RegExp(`([^.]*${keyword}[^.]*)`, 'i'))
      if (match) {
        fields.location = match[0].trim()
        break
      }
    }
  }

  return fields
}

function isAnswerable(fields: EventFields): boolean {
  return Boolean(fields.date || fields.weeklyRule)
}

function formatEventAnswer(fields: EventFields, query: string): string {
  const name = fields.title || query
  const segments: string[] = []

  if (fields.weeklyRule) {
    let clause = `${name} happens ${fields.weeklyRule}`
    if (fields.time) {
      clause += ` at ${fields.time}`
    }
    segments.push(clause + '.')
  } else if (fields.date) {
    let clause = `${name} is on ${fields.date}`
    if (fields.time) {
      clause += ` at ${fields.time}`
    }
    segments.push(clause + '.')
  }

  if (fields.location) {
    const locationSentence = fields.location.endsWith('.') ? fields.location : `${fields.location}.`
    segments.push(locationSentence)
  }

  if (fields.context) {
    segments.push(truncateAdditionalContext(fields.context, segments.join(' ')))
  }

  return segments.filter(Boolean).join(' ')
}

function truncateAdditionalContext(context: string, already: string): string {
  const cleaned = context.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 0) return ''
  const maxLen = 360 - already.length
  if (maxLen <= 60) return ''
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() + '...' : cleaned
}
