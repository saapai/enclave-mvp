/**
 * Execute Answer Mode
 * 
 * Handles query answering with hybrid RAG retrieval (V2 - sequential, budget-aware)
 */

import { TurnFrame, ContextEnvelope } from '../types'
import { hybridSearchV2, getCachedEmbedding } from '@/lib/search-v2'
import { planQuery, composeResponse, executePlan } from '@/lib/planner'
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
  
  try {
    // Step 1: Get workspace IDs (with 500ms timeout via new workspace.ts)
    const workspaceStart = Date.now()
    console.log(`[Execute Answer] [${traceId}] About to call getWorkspaceIds`)
    const spaceIds = await getWorkspaceIds({
      phoneNumber: frame.user.id,
      includeSepFallback: true,
      includePhoneLookup: false
    })
    
    const workspaceDuration = Date.now() - workspaceStart
    console.log(`[Execute Answer] [${traceId}] Retrieved ${spaceIds.length} workspace ids in ${workspaceDuration}ms`)
    console.log(`[Execute Answer] [${traceId}] Workspace IDs:`, spaceIds)
    
    // Filter out default workspace
    const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'
    const realSpaces = spaceIds.filter(id => id && id !== DEFAULT_SPACE_ID)
    
    // Prioritize SEP workspace if env var is set
    const SEP_SPACE_ID = process.env.SEP_SPACE_ID
    const prioritizedSpaces = SEP_SPACE_ID && realSpaces.includes(SEP_SPACE_ID)
      ? [SEP_SPACE_ID, ...realSpaces.filter(id => id !== SEP_SPACE_ID)]
      : realSpaces
    
    // Hard cap at 4 workspaces for SMS (all 4 UCLA SEP workspaces)
    const workspaceIds = prioritizedSpaces.slice(0, 4)
    
    let orderedWorkspaceIds = workspaceIds
    try {
      const ranked = await rankWorkspaceIds(workspaceIds)
      if (ranked.length === workspaceIds.length) {
        orderedWorkspaceIds = ranked
      }
    } catch (err) {
      console.error(`[Execute Answer] [${traceId}] Failed to rank workspaces:`, err)
    }
    
    console.log(`[Execute Answer] [${traceId}] Filtered workspaces: ${spaceIds.length} -> ${workspaceIds.length}`)
    console.log(`[Execute Answer] [${traceId}] Search order: ${orderedWorkspaceIds.join(', ')}`)
    
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
    const searchResults = await hybridSearchV2(query, orderedWorkspaceIds, {
      budgetMs: searchBudget,
      highConfidenceThreshold: 0.75,
      mediumConfidenceThreshold: 0.50
    })
    
    const searchDuration = Date.now() - searchStart
    console.log(`[Execute Answer] [${traceId}] Search completed in ${searchDuration}ms, found ${searchResults.length} results`)
    
    if (searchResults.length > 0) {
      console.log(`[Execute Answer] [${traceId}] Top result: "${searchResults[0].title}" (score: ${searchResults[0].score?.toFixed(3)})`)
    }
    
    // Step 3: If we have good results, compose response directly
    if (searchResults.length > 0 && searchResults[0].score && searchResults[0].score >= 0.60) {
      console.log(`[Execute Answer] [${traceId}] Good results found, composing response directly`)
      
      // Use the top result's body for context
      const topResult = searchResults[0]
      const context = topResult.body || topResult.title
      
      if (!context || context.length < 10) {
        console.log(`[Execute Answer] [${traceId}] Top result has no content, trying next result`)
        if (searchResults.length > 1) {
          const secondResult = searchResults[1]
          const secondContext = secondResult.body || secondResult.title
          if (secondContext && secondContext.length >= 10) {
            return await composeDirectResponse(query, secondContext, traceId)
          }
        }
        // Fallback
        return {
          messages: [`Found "${topResult.title}" but couldn't extract the details. Try asking more specifically.`]
        }
      }
      
      return await composeDirectResponse(query, context, traceId)
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
    const topResult = searchResults[0]
    const context = topResult.body || topResult.title
    
    if (context && context.length >= 10) {
      return await composeDirectResponse(query, context, traceId)
    }
    
    // Final fallback
    return {
      messages: [`Found some results but they don't seem relevant to "${query}". Try being more specific.`]
    }
    
  } catch (error) {
    console.error(`[Execute Answer] [${traceId}] Error:`, error)
    return {
      messages: ["Sorry, I ran into an issue searching for that. Please try again."]
    }
  } finally {
    const totalDuration = Date.now() - overallStart
    console.log(`[Execute Answer] [${traceId}] Completed in ${totalDuration}ms`)
  }
}

/**
 * Compose a direct response using LLM (Mistral API)
 */
async function composeDirectResponse(
  query: string,
  context: string,
  traceId: string
): Promise<ExecuteResult> {
  console.log(`[Execute Answer] [${traceId}] Composing direct response`)
  
  try {
    // Truncate context if too long
    const maxContextLength = 2000
    const truncatedContext = context.length > maxContextLength
      ? context.substring(0, maxContextLength) + '...'
      : context
    
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
            content: 'You are a helpful assistant answering questions based on provided context. Be concise and direct. If the context doesn\'t contain the answer, say so.'
          },
          {
            role: 'user',
            content: `Context:\n${truncatedContext}\n\nQuestion: ${query}\n\nAnswer the question based on the context above. Be brief and specific.`
          }
        ],
        temperature: 0.3,
        max_tokens: 200
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
    
    console.log(`[Execute Answer] [${traceId}] Composed response: "${answer.substring(0, 100)}..."`)
    return {
      messages: [answer]
    }
    
  } catch (err) {
    console.error(`[Execute Answer] [${traceId}] Error composing response:`, err)
    return {
      messages: ["I found some information but couldn't process it properly. Please try again."]
    }
  }
}
