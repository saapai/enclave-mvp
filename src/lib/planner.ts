/**
 * Query Planner
 * Autonomous planning system that decides how to answer queries
 * Replaces simple "classify & summarize" with intelligent tool execution
 */

import { ENV } from './env'
import { findEventByName, findPolicyByTitle, getLinkbacks } from './knowledge-graph'
import { searchResourcesHybrid } from './search'

// ============================================================================
// TYPES
// ============================================================================

export interface QueryPlan {
  intent: 'event_lookup' | 'policy_lookup' | 'person_lookup' | 'doc_search' | 'clarify' | 'chat'
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

  if (!ENV.MISTRAL_API_KEY) {
    console.error('[Planner] MISTRAL_API_KEY not set, using fallback')
    return fallbackPlan(query)
  }

  const systemPrompt = `You are a query planner. Analyze the user's query and create an execution plan.

INTENTS:
- event_lookup: "when is X", "where is X", "what time is X"
- policy_lookup: "what is the policy on X", "how does X work"
- person_lookup: "who is X", "what's X's role"
- doc_search: general questions requiring document search
- clarify: ambiguous query needing clarification
- chat: casual conversation

ENTITIES TO EXTRACT:
- events: meeting names, event names
- policies: policy/program names
- people: person names, roles
- dates: specific dates or time references
- locations: places, buildings, rooms

TOOLS AVAILABLE:
1. search_knowledge: Query knowledge graph (events, policies, people)
2. search_docs: Full-text + vector search across documents
3. calendar_find: Query calendar events
4. linkify_sources: Get source citations
5. compose_response: Format final answer

RULES:
- Prefer knowledge graph (high confidence, fast)
- Fallback to doc search if graph fails
- Request clarification if ambiguous
- Confidence > 0.7 = execute, < 0.5 = clarify

Return JSON with: intent, confidence, entities, tools (ordered by priority), reasoning`

  const userPrompt = `Query: "${query}"

Workspace context: ${spaceId}

Create execution plan (JSON only):`

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
        max_tokens: 500,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.error('[Planner] API error:', response.status)
      return fallbackPlan(query)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return fallbackPlan(query)
    }

    const plan: QueryPlan = JSON.parse(content)
    console.log(`[Planner] Intent: ${plan.intent}, Confidence: ${plan.confidence}`)
    console.log(`[Planner] Tools: ${plan.tools.map(t => t.tool).join(', ')}`)

    return plan

  } catch (error) {
    console.error('[Planner] Error:', error)
    return fallbackPlan(query)
  }
}

/**
 * Fallback plan when LLM is unavailable
 */
function fallbackPlan(query: string): QueryPlan {
  const lowerQuery = query.toLowerCase()

  // Simple regex-based intent detection
  if (lowerQuery.match(/when is|what time|where is/)) {
    return {
      intent: 'event_lookup',
      confidence: 0.7,
      entities: { events: [query] },
      tools: [
        { tool: 'search_knowledge', params: { type: 'event', query }, priority: 1 },
        { tool: 'search_docs', params: { query }, priority: 2 }
      ]
    }
  }

  if (lowerQuery.match(/what is|how does|policy|rule/)) {
    return {
      intent: 'policy_lookup',
      confidence: 0.7,
      entities: { policies: [query] },
      tools: [
        { tool: 'search_knowledge', params: { type: 'policy', query }, priority: 1 },
        { tool: 'search_docs', params: { query }, priority: 2 }
      ]
    }
  }

  // Default to doc search
  return {
    intent: 'doc_search',
    confidence: 0.6,
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
  spaceId: string
): Promise<ToolResult> {
  console.log(`[Tool Executor] Executing: ${tool.tool}`)

  try {
    switch (tool.tool) {
      case 'search_knowledge':
        return await executeSearchKnowledge(tool.params, spaceId)

      case 'search_docs':
        return await executeSearchDocs(tool.params, spaceId)

      case 'calendar_find':
        return await executeCalendarFind(tool.params, spaceId)

      default:
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

  if (type === 'event') {
    const events = await findEventByName(query, spaceId)
    
    if (events.length > 0) {
      const event = events[0]
      const sources = await getLinkbacks('event', event.event_id as string)
      
      return {
        tool: 'search_knowledge',
        success: true,
        data: { events, sources },
        confidence: 0.9
      }
    }
  } else if (type === 'policy') {
    const policies = await findPolicyByTitle(query, spaceId)
    
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
  spaceId: string
): Promise<ToolResult> {
  const { query } = params

  const results = await searchResourcesHybrid(query, spaceId, {}, { limit: 5 })

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
 * Search calendar
 */
async function executeCalendarFind(
  params: Record<string, any>,
  spaceId: string
): Promise<ToolResult> {
  // TODO: Implement calendar-specific search
  // For now, delegate to doc search
  return executeSearchDocs(params, spaceId)
}

/**
 * Execute all tools in plan until one succeeds
 */
export async function executePlan(
  plan: QueryPlan,
  spaceId: string
): Promise<ToolResult[]> {
  console.log(`[Tool Executor] Executing plan with ${plan.tools.length} tools`)

  const results: ToolResult[] = []

  // Execute tools in priority order
  const sortedTools = [...plan.tools].sort((a, b) => a.priority - b.priority)

  for (const tool of sortedTools) {
    const result = await executeTool(tool, spaceId)
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

  // Find best result
  const bestResult = results
    .filter(r => r.success)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0]

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
  if (plan.intent === 'event_lookup') {
    return composeEventResponse(bestResult)
  } else if (plan.intent === 'policy_lookup') {
    return composePolicyResponse(bestResult)
  } else {
    return composeDocResponse(bestResult)
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
      text += '\n\nKey points:\n' + policy.bullets.map(b => `• ${b}`).join('\n')
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
 * Compose doc search response
 */
function composeDocResponse(result: ToolResult): ComposedResponse {
  if (result.tool === 'search_docs' && result.data?.results) {
    const topResult = result.data.results[0]

    // Extract relevant snippet (first 300 chars)
    const snippet = topResult.body?.substring(0, 300) || topResult.title

    return {
      text: snippet,
      sources: [topResult.title],
      confidence: result.confidence || 0.5,
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

