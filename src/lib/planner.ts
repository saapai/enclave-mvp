/**
 * Query Planner
 * Autonomous planning system that decides how to answer queries
 * Replaces simple "classify & summarize" with intelligent tool execution
 */

import { ENV } from './env'
import { findEventByName, findPolicyByTitle, getLinkbacks } from './knowledge-graph'
import { searchResourcesHybridWithEmbedding } from './search'
import { supabase } from './supabase'

// ============================================================================
// TYPES
// ============================================================================

export interface QueryPlan {
  intent: 'event_lookup' | 'policy_lookup' | 'person_lookup' | 'doc_search' | 'clarify' | 'chat' | 'content_summary'
  confidence: number
  entities: {
    events?: string[]
    policies?: string[]
    people?: string[]
    dates?: string[]
    locations?: string[]
  }
  tools: ToolCall[]
  reasoning?: string
}

export interface ToolCall {
  tool: string
  params: Record<string, any>
  priority: number
}

export interface ToolResult {
  tool: string
  success: boolean
  data: any
  confidence?: number
}

export interface ComposedResponse {
  text: string
  sources: string[]
  confidence: number
  needsClarification: boolean
  clarificationQuestion?: string
}

// ============================================================================
// PLANNER
// ============================================================================

/**
 * Analyze query and create execution plan
 */
export async function planQuery(
  query: string,
  spaceId: string
): Promise<QueryPlan> {
  console.log(`[Planner] Planning query: "${query}"`)

  // Try LLM-based planning first
  try {
    const llmPlan = await llmPlanQuery(query, spaceId)
    if (llmPlan && llmPlan.confidence > 0.7) {
      console.log(`[Planner] LLM plan confidence: ${llmPlan.confidence}`)
      return llmPlan
    }
    console.log(`[Planner] LLM plan low confidence (${llmPlan?.confidence}), falling back`)
  } catch (error) {
    console.error(`[Planner] LLM planning failed:`, error)
  }

  // Fallback to rule-based plan
  return fallbackPlan(query)
}

/**
 * LLM-based query planning
 * Uses Mistral API to intelligently route queries
 */
async function llmPlanQuery(query: string, spaceId: string): Promise<QueryPlan | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 4000)
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
            content: `You are a query classifier for an AI assistant called Jarvis. Classify user queries into intent categories and recommend search strategies.

INTENTS:
- event_lookup: Specific questions about event times/locations (e.g., "when is active meeting", "where is study hall")
- policy_lookup: Questions about policies, rules, or how things work (e.g., "what is big little", "how does attendance work")
- person_lookup: Who is someone (e.g., "who is sarah", "tell me about john")
- doc_search: General info queries that need document search (e.g., "what's happening this week", "tell me about events")
- chat: Pure greetings or casual conversation (e.g., "hey", "what's up", "thanks")
- content_summary: Complex queries requiring multi-source synthesis

Return ONLY valid JSON with this exact structure:
{
  "intent": "event_lookup|policy_lookup|person_lookup|doc_search|chat|content_summary",
  "confidence": 0.0-1.0,
  "entities": {
    "events": ["event_name"] (optional),
    "policies": ["policy_name"] (optional),
    "people": ["person_name"] (optional),
    "dates": ["date_reference"] (optional),
    "locations": ["location"] (optional)
  },
  "tools": [
    {"tool": "search_docs|search_announcements|search_knowledge|calendar_find", "params": {"query": "..."}, "priority": 1-5}
  ],
  "reasoning": "brief explanation"
}`
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0.1,
        max_tokens: 300
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error(`[Planner LLM] API error: ${response.status}`)
      return null
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content

    if (!content) {
      console.error('[Planner LLM] No content in response')
      return null
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[Planner LLM] No JSON found in response')
      return null
    }

    const plan: QueryPlan = JSON.parse(jsonMatch[0])
    console.log(`[Planner LLM] Classified as: ${plan.intent}, confidence: ${plan.confidence}`)
    
    return plan

  } catch (error) {
    console.error('[Planner LLM] Error:', error)
    return null
  }
}

/**
 * Fallback plan when LLM is unavailable
 * This is actually the MAIN planner now
 */
function fallbackPlan(query: string): QueryPlan {
  const lowerQuery = query.toLowerCase()

  // 1. DETECT CONTENT/INFO QUERIES (these need actual search, NOT chat)
  const contentPatterns = [
    /what's\s+(going on|happening|upcoming|new|coming up)/i,
    /what's up with/i,
    /tell me (about|more)/i,
    /what are/i,
    /what is/i,
    /when is/i,
    /where is/i,
    /when are/i,
    /when's/i,
    /upcoming events/i,
    /what's this week/i
  ]
  
  const isContentQuery = contentPatterns.some(pattern => pattern.test(lowerQuery))
  
  if (isContentQuery) {
    // Extract event names if specific
    const eventMatch = lowerQuery.match(/when (?:is|are) (.+)|what time is (.+)/i)
    const eventName = eventMatch ? (eventMatch[1] || eventMatch[2] || '').trim() : ''
    
    if (eventName && eventName.length < 50) {
      // Specific event lookup
      return {
        intent: 'event_lookup',
        confidence: 0.9,
        entities: { events: [eventName] },
        tools: [
          { tool: 'search_docs', params: { query }, priority: 1 }
        ]
      }
    } else {
      // Broad info query - search for comprehensive answer
      return {
        intent: 'doc_search',
        confidence: 0.9,
        entities: {},
        tools: [
          { tool: 'search_announcements', params: { query }, priority: 1 }, // Check announcements first (most recent info)
          { tool: 'search_docs', params: { query }, priority: 2 }
        ]
      }
    }
  }

  // 2. DETECT CASUAL CHAT (only pure greetings, no info requests)
  const chatPatterns = [
    /^(hey|hi|hello|sup|wassup)\s*$/i,
    /^what's up\s*\?*$/i,
    /^what's new\s*\?*$/i,
    /^(how are you|how are things)\s*$/i,
    /^(not much|doing well|all good|you?)\s*$/i
  ]
  
  const isPureChat = chatPatterns.some(pattern => pattern.test(lowerQuery.trim()))
  
  if (isPureChat) {
    return {
      intent: 'chat',
      confidence: 0.9,
      entities: {},
      tools: [] // No tools for casual chat
    }
  }

  // 3. DEFAULT: Treat as content query (if not pure chat and not explicit content)
  return {
    intent: 'doc_search',
    confidence: 0.7,
    entities: {},
    tools: [
      { tool: 'search_docs', params: { query }, priority: 1 }
    ]
  }
}

// ============================================================================
// TOOL EXECUTOR
// ============================================================================

/**
 * Execute a single tool
 */
async function executeTool(
  tool: ToolCall,
  spaceId: string,
  queryEmbedding: number[] | null = null
): Promise<ToolResult> {
  console.log(`[Tool Executor] Executing: ${tool.tool}`)

  try {
    switch (tool.tool) {
      case 'search_knowledge':
        return await executeSearchKnowledge(tool.params, spaceId)

      case 'search_docs':
        return await executeSearchDocs(tool.params, spaceId, queryEmbedding)

      case 'search_announcements':
        return await executeSearchAnnouncements(tool.params, spaceId)

      case 'calendar_find':
        return await executeCalendarFind(tool.params, spaceId, queryEmbedding)

      default:
        console.log(`[Tool Executor] Unknown tool: ${tool.tool}`)
        return {
          tool: tool.tool,
          success: false,
          data: null,
          confidence: 0
        }
    }
  } catch (error) {
    console.error(`[Tool Executor] Error executing ${tool.tool}:`, error)
    return {
      tool: tool.tool,
      success: false,
      data: null,
      confidence: 0
    }
  }
}

/**
 * Search knowledge graph
 */
async function executeSearchKnowledge(
  params: Record<string, any>,
  spaceId: string
): Promise<ToolResult> {
  const { type, query } = params

  console.log(`[search_knowledge] Searching for ${type}: "${query}"`)

  if (type === 'event') {
    const events = await findEventByName(query, spaceId)
    console.log(`[search_knowledge] Found ${events.length} events`)
    
    if (events.length > 0) {
      const event = events[0]
      const sources = await getLinkbacks('event', (event as any).event_id as string)
      
      return {
        tool: 'search_knowledge',
        success: true,
        data: { events, sources },
        confidence: 0.9
      }
    }
  } else if (type === 'policy') {
    const policies = await findPolicyByTitle(query, spaceId)
    console.log(`[search_knowledge] Found ${policies.length} policies`)
    
    if (policies.length > 0) {
      const policy = policies[0]
      const sources = await getLinkbacks('policy', policy.id)
      
      return {
        tool: 'search_knowledge',
        success: true,
        data: { policies, sources },
        confidence: 0.9
      }
    }
  }

  console.log(`[search_knowledge] No results for ${type}: "${query}"`)
  return {
    tool: 'search_knowledge',
    success: false,
    data: null,
    confidence: 0
  }
}

/**
 * Search documents
 */
async function executeSearchDocs(
  params: Record<string, any>,
  spaceId: string,
  queryEmbedding: number[] | null = null
): Promise<ToolResult> {
  const { query } = params

  console.log(`[search_docs] Searching documents: "${query}"`)

  const results = await searchResourcesHybridWithEmbedding(
    query,
    spaceId,
    queryEmbedding,
    {},
    { limit: 5 },
    undefined
  )

  console.log(`[search_docs] Found ${results.length} results`)

  if (results.length > 0) {
    return {
      tool: 'search_docs',
      success: true,
      data: { results },
      confidence: results[0].score || 0.5
    }
  }

  return {
    tool: 'search_docs',
    success: false,
    data: null,
    confidence: 0
  }
}

/**
 * Search announcements (recent sent announcements)
 */
async function executeSearchAnnouncements(
  params: Record<string, any>,
  spaceId: string
): Promise<ToolResult> {
  const { query } = params
  
  console.log(`[search_announcements] Searching announcements: "${query}"`)
  
  // Search for recent announcements that are relevant to the query
  // First try to find any sent announcements (ignore workspace_id to catch all)
  const { data: allAnnouncements } = await supabase
    .from('announcement')
    .select('id, final_content, sent_at, created_at, workspace_id')
    .eq('status', 'sent')
    .not('final_content', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(20)
  
  console.log(`[search_announcements] Found ${allAnnouncements?.length || 0} total announcements`)
  
  if (!allAnnouncements || allAnnouncements.length === 0) {
    console.log(`[search_announcements] No announcements found`)
    return {
      tool: 'search_announcements',
      success: false,
      data: null,
      confidence: 0
    }
  }
  
  // Improved keyword matching - extract key terms from query
  const lowerQuery = (query || '').toLowerCase()
  const queryWords = lowerQuery.split(/\s+/).filter((word: string) => word.length > 2) // Ignore short words like "at", "the"
  
  // Score announcements by matching keywords
  const scoredAnnouncements = allAnnouncements.map(ann => {
    const content = (ann.final_content || '').toLowerCase()
    let score = 0
    
    // Exact phrase match gets highest score
    if (content.includes(lowerQuery)) {
      score += 10
    }
    
    // Word-by-word matching
    for (const word of queryWords) {
      if (content.includes(word)) {
        score += 1
      }
    }
    
    return { ann, score }
  })
  
  // Filter to announcements with at least one keyword match, sort by score
  const matching = scoredAnnouncements
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.ann)
  
  console.log(`[search_announcements] Found ${matching.length} matching announcements (top score: ${scoredAnnouncements.length > 0 ? Math.max(...scoredAnnouncements.map(s => s.score)) : 0})`)
  
  if (matching.length > 0) {
    // Convert to SearchResult format for compatibility
    const results = matching.map(ann => ({
      id: ann.id,
      title: 'Announcement',
      body: ann.final_content || '',
      type: 'announcement' as const,
      space_id: spaceId,
      created_at: ann.sent_at || ann.created_at,
      updated_at: ann.sent_at || ann.created_at,
      created_by: null,
      tags: [],
      rank: 0.9, // High rank for recent announcements
      score: 0.9,
      url: null,
      metadata: {}
    }))
    
    return {
      tool: 'search_announcements',
      success: true,
      data: { results },
      confidence: 0.9
    }
  }
  
  return {
    tool: 'search_announcements',
    success: false,
    data: null,
    confidence: 0
  }
}

/**
 * Search calendar
 */
async function executeCalendarFind(
  params: Record<string, any>,
  spaceId: string,
  queryEmbedding: number[] | null = null
): Promise<ToolResult> {
  // TODO: Implement calendar-specific search
  // For now, delegate to doc search
  return executeSearchDocs(params, spaceId, queryEmbedding)
}

/**
 * Execute all tools in plan until one succeeds
 */
export async function executePlan(
  plan: QueryPlan,
  spaceId: string,
  queryEmbedding: number[] | null = null
): Promise<ToolResult[]> {
  console.log(`[Tool Executor] Executing plan with ${plan.tools.length} tools`)

  const results: ToolResult[] = []
  const executedSignatures = new Set<string>()

  // Execute tools in priority order
  const sortedTools = [...plan.tools].sort((a, b) => a.priority - b.priority)

  for (const tool of sortedTools) {
    const signature = `${tool.tool}:${JSON.stringify(tool.params || {})}`
    if (executedSignatures.has(signature)) {
      console.log(`[Tool Executor] Skipping duplicate tool ${signature}`)
      continue
    }
    executedSignatures.add(signature)

    const result = await executeTool(tool, spaceId, queryEmbedding)
    results.push(result)

    // Stop if we got a high-confidence result
    if (result.success && (result.confidence || 0) > 0.7) {
      console.log(`[Tool Executor] High-confidence result from ${tool.tool}, stopping`)
      break
    }
  }

  return results
}

// ============================================================================
// RESPONSE COMPOSER
// ============================================================================

/**
 * Compose final response from tool results
 */
export async function composeResponse(
  query: string,
  plan: QueryPlan,
  results: ToolResult[]
): Promise<ComposedResponse> {
  console.log(`[Composer] Composing response from ${results.length} tool results`)

  // Find all successful results, sorted by confidence
  const successfulResults = results
    .filter(r => r.success)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
  
  const bestResult = successfulResults[0]

  if (!bestResult) {
    // No results found
    if (plan.confidence < 0.5) {
      return {
        text: "I'm not sure what you're asking. Could you rephrase that?",
        sources: [],
        confidence: 0,
        needsClarification: true,
        clarificationQuestion: "Could you be more specific about what you're looking for?"
      }
    }

    return {
      text: "I couldn't find any information about that. Want me to search the docs for the latest mention?",
      sources: [],
      confidence: 0,
      needsClarification: false
    }
  }

  // Compose response based on intent
  if (plan.intent === 'chat') {
    return composeChatResponse(query, bestResult ? [bestResult] : results)
  } else if (plan.intent === 'event_lookup') {
    // For event lookups, if no results found, provide a helpful message
    if (!bestResult || !bestResult.data || !bestResult.data.events || bestResult.data.events.length === 0) {
      return {
        text: "I couldn't find any upcoming events matching that. Try asking about specific events or check your calendar.",
        sources: [],
        confidence: 0,
        needsClarification: false
      }
    }
    return composeEventResponse(bestResult)
  } else if (plan.intent === 'policy_lookup') {
    return composePolicyResponse(bestResult)
  } else if (plan.intent === 'doc_search' || plan.intent === 'content_summary') {
    // Content queries should use ALL relevant results, not just the top one
    return composeDocResponse(bestResult, successfulResults.slice(0, 5))
  } else {
    return composeDocResponse(bestResult, successfulResults.slice(0, 5))
  }
}

/**
 * Compose chat response with context awareness
 */
function composeChatResponse(query: string, results?: ToolResult[]): ComposedResponse {
  // If we have document results (user asked about something specific), provide info
  if (results && results.length > 0 && results[0].data?.results && results[0].data.results.length > 0) {
    return composeDocResponse(results[0])
  }
  
  // Otherwise, friendly casual response
  const responses = [
    "Hey! What's up?",
    "Not much, you?",
    "Just here, ready to help! What do you need?",
    "All good here! What can I help you with?",
    "Hey! What's going on?",
  ]
  
  const randomResponse = responses[Math.floor(Math.random() * responses.length)]
  
  return {
    text: randomResponse,
    sources: [],
    confidence: 0.9,
    needsClarification: false
  }
}

/**
 * Compose event response
 */
function composeEventResponse(result: ToolResult): ComposedResponse {
  if (result.tool === 'search_knowledge' && result.data?.events) {
    const event = result.data.events[0]
    const sources = result.data.sources || []

    let text = `${event.event_name}`

    if (event.start_at) {
      const date = new Date(event.start_at)
      text += ` is ${date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
      })} at ${date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit' 
      })}`
    }

    if (event.location) {
      text += ` at ${event.location}`
    }

    text += '.'

    if (sources.length > 0) {
      text += `\n\nSource: ${sources[0]}`
    }

    return {
      text,
      sources,
      confidence: 0.95,
      needsClarification: false
    }
  }

  // calendar_find returns doc search results, so use those
  if (result.tool === 'calendar_find' && result.data?.results && result.data.results.length > 0) {
    return composeDocResponse(result)
  }

  // Fallback to doc search result
  return composeDocResponse(result)
}

/**
 * Compose policy response
 */
function composePolicyResponse(result: ToolResult): ComposedResponse {
  if (result.tool === 'search_knowledge' && result.data?.policies) {
    const policy = result.data.policies[0]
    const sources = result.data.sources || []

    let text = policy.title

    if (policy.summary) {
      text += `\n\n${policy.summary}`
    }

    if (policy.bullets && policy.bullets.length > 0) {
      text += '\n\nKey points:\n' + policy.bullets.map((bullet: string) => `• ${bullet}`).join('\n')
    }

    if (sources.length > 0) {
      text += `\n\nSource: ${sources[0]}`
    }

    return {
      text,
      sources,
      confidence: 0.9,
      needsClarification: false
    }
  }

  return composeDocResponse(result)
}

/**
 * Compose doc search response using AI summarization
 */
function composeDocResponse(primaryResult: ToolResult, allResults?: ToolResult[]): ComposedResponse {
  // Handle both search_docs and calendar_find (which returns doc search results)
  const hasResults = (primaryResult.tool === 'search_docs' || primaryResult.tool === 'calendar_find') && 
                     primaryResult.data?.results
  
  if (hasResults) {
    // Use multiple results to get comprehensive context
    const resultsToUse = allResults || [primaryResult]
    const allDocs: any[] = []
    
    // Collect all document results
    for (const result of resultsToUse) {
      if ((result.tool === 'search_docs' || result.tool === 'calendar_find') && result.data?.results) {
        allDocs.push(...result.data.results.slice(0, 3)) // Top 3 from each result
      }
    }
    
    // Deduplicate by ID
    const uniqueDocs = Array.from(new Map(allDocs.map(doc => [doc.id, doc])).values())
    
    // Combine content from multiple docs for comprehensive answers
    const combinedText = uniqueDocs
      .slice(0, 5) // Use top 5 unique documents
      .map(doc => doc.body || doc.title)
      .join('\n\n')
    
    const sources = uniqueDocs.slice(0, 5).map(doc => doc.title)

    // For doc search, we need to call the AI to summarize
    // The SMS handler should handle this
    // Here we return combined content from multiple docs
    return {
      text: combinedText || uniqueDocs[0]?.body || uniqueDocs[0]?.title,
      sources,
      confidence: primaryResult.confidence || 0.5,
      needsClarification: false
    }
  }

  return {
    text: "I couldn't find specific information about that.",
    sources: [],
    confidence: 0,
    needsClarification: false
  }
}
