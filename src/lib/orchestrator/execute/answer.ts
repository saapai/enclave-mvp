/**
 * Execute Answer Mode
 * 
 * Handles query answering with hybrid RAG retrieval
 */

import { TurnFrame, ContextEnvelope } from '../types'
import { searchResourcesHybrid } from '@/lib/search'
import { planQuery, composeResponse, executePlan } from '@/lib/planner'
import { getWorkspaceIds } from '@/lib/workspace'

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
  const query = frame.text
  
  // Get workspace IDs
  const spaceIds = await getWorkspaceIds()
  if (spaceIds.length === 0) {
    return {
      messages: ['I couldn\'t find any workspaces. Please contact support.']
    }
  }
  
  // Cross-workspace search
  const allResults = []
  for (const spaceId of spaceIds) {
    const results = await searchResourcesHybrid(
      query,
      spaceId,
      {},
      { limit: 5, offset: 0 },
      undefined
    )
    allResults.push(...results)
  }
  
  // Deduplicate
  const uniqueResultsMap = new Map()
  for (const result of allResults) {
    if (!uniqueResultsMap.has(result.id)) {
      uniqueResultsMap.set(result.id, result)
    }
  }
  const dedupedResults = Array.from(uniqueResultsMap.values())
    .sort((a, b) => (b.score || b.rank || 0) - (a.score || a.rank || 0))
    .slice(0, 3)
  
  // Use planner-based flow
  try {
    const plan = await planQuery(query, spaceIds[0])
    
    // Execute plan across all workspaces and combine results
    const allToolResults: any[] = []
    for (const spaceId of spaceIds) {
      const toolResults = await executePlan(plan, spaceId)
      allToolResults.push(...toolResults)
    }
    
    // Deduplicate tool results by tool name and keep highest confidence
    const toolResultsMap = new Map<string, any>()
    for (const result of allToolResults) {
      const existing = toolResultsMap.get(result.tool)
      if (!existing || (result.confidence || 0) > (existing.confidence || 0)) {
        // Merge data if both have results arrays
        if (existing && existing.data?.results && result.data?.results) {
          const mergedResults = [...existing.data.results, ...result.data.results]
          const uniqueResults = Array.from(new Map(mergedResults.map((r: any) => [r.id, r])).values())
          toolResultsMap.set(result.tool, {
            ...result,
            data: { ...result.data, results: uniqueResults }
          })
        } else {
          toolResultsMap.set(result.tool, result)
        }
      }
    }
    let toolResults = Array.from(toolResultsMap.values())
    
    // If knowledge graph found nothing, use cross-workspace results
    const hasGoodKnowledgeResult = toolResults.some(r => r.success && (r.confidence || 0) > 0.7)
    
    if (!hasGoodKnowledgeResult && dedupedResults.length > 0) {
      toolResults = [{
        tool: 'search_docs',
        success: true,
        data: { results: dedupedResults },
        confidence: 0.8
      }]
    }
    
    // Compose response
    const composed = await composeResponse(query, plan, toolResults)
    console.log(`[Execute Answer] Composed response: text length=${composed.text?.length || 0}, intent=${plan.intent}, toolResults=${toolResults.length}`)
    console.log(`[Execute Answer] Composed text preview: "${composed.text?.substring(0, 200)}"`)
    
    // Check if we have actual document results but composed text is fallback
    const hasDocumentResults = toolResults.length > 0 && toolResults[0].data?.results && toolResults[0].data.results.length > 0
    const isFallbackMessage = composed.text?.includes("I couldn't find") || composed.text?.length < 50
    
    if (hasDocumentResults && isFallbackMessage) {
      console.log(`[Execute Answer] WARNING: Found documents but composer returned fallback. Using document content directly.`)
      // Extract document content directly
      const topResult = toolResults[0].data.results[0]
      if (topResult?.body) {
        composed.text = topResult.body
        console.log(`[Execute Answer] Using document body directly, length: ${topResult.body.length}`)
      } else if (topResult?.title) {
        composed.text = topResult.title
        console.log(`[Execute Answer] Using document title as fallback: ${topResult.title}`)
      }
    }
    
    // Try AI summarization if we have results
    let finalText = composed.text || ''
    
    // For event_lookup, ALWAYS use AI if we have document results
    // Only use composed text directly if it's already a good summary (not a fallback or raw document)
    if (plan.intent === 'event_lookup') {
      const hasDocs = toolResults.length > 0 && toolResults[0].data?.results && toolResults[0].data.results.length > 0
      const isGoodSummary = composed.text && 
                             composed.text.length > 10 && 
                             composed.text.length < 500 && 
                             !composed.text.includes('\n\n') &&
                             !composed.text.toLowerCase().includes("i couldn't find")
      
      // If we have documents, always try AI (unless already a good summary)
      if (hasDocs && !isGoodSummary) {
        // Too long or raw document, try AI summarization with timeout, then fallback to document
        const allResults = toolResults[0].data.results
        const topResult = allResults[0]
        
        // Extract document snippet first (in case AI fails)
        let documentSnippet = ''
        if (topResult?.body) {
          const bodyLower = topResult.body.toLowerCase()
          const queryLower = query.toLowerCase()
          
          // Try to find relevant snippet around query keywords
          const keywords = queryLower.split(' ').filter(w => w.length > 2)
          let keywordIndex = -1
          
          for (const keyword of keywords) {
            const idx = bodyLower.indexOf(keyword)
            if (idx > -1) {
              keywordIndex = idx
              break
            }
          }
          
          if (keywordIndex > -1) {
            // Extract snippet around keyword (200 chars before, 300 chars after)
            documentSnippet = topResult.body.substring(
              Math.max(0, keywordIndex - 200), 
              Math.min(topResult.body.length, keywordIndex + 300)
            ).trim()
          } else {
            // No keyword found, use first 500 chars
            documentSnippet = topResult.body.substring(0, 500).trim()
          }
        } else {
          documentSnippet = topResult?.title || ''
        }
        
        // Try AI summarization with timeout (max 5 seconds)
        let aiSucceeded = false
        if (topResult?.body && topResult.body.length > 10) {
          try {
            const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
            
            // Extract date information from document for better context
            const now = new Date()
            const currentDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            const currentDayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' })
            
            // Get action memory context from envelope if available
            const actionMemory = envelope.evidence?.find(e => e.scope === 'ACTION' && e.source_id?.includes('action_memory'))
            const actionContext = actionMemory?.text ? `\n\nRecent actions:\n${actionMemory.text}` : ''
            
            const enclaveReference = `Enclave System Reference:
- Name: Enclave
- Type: Multi-modal organizational AI assistant platform
- Purpose: Unify organization's communications and knowledge across SMS, Slack, Google Calendar, Docs
- Primary developer: Saathvik Pai
- Core team: The Inquiyr development team
- Built as part of the Inquiyr ecosystem
- Technical stack: Next.js, TypeScript, Supabase, Twilio, Mistral AI
- Capabilities: Knowledge retrieval, SMS messaging, announcements, polls, alerts, search
- Target users: Student organizations, professional fraternities, small teams, clubs`
            
            const aiRes = await fetch(aiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query,
                context: `Title: ${topResult.title}\nContent: ${topResult.body.substring(0, 2000)}\n\nIMPORTANT: Today is ${currentDayOfWeek}, ${currentDate}. Extract the ACTUAL date from the document content, not "today". If the document says "Nov 13" or "November 13", use that exact date. Do not use relative dates like "today" unless the document explicitly says "today".${actionContext}\n\n${enclaveReference}\n\nIf the user is asking about past actions (e.g., "did you find", "why didn't you send"), use the Recent actions context above to answer their question directly. Use emojis sparingly (0 or 1).`,
                type: 'summary'
              }),
              signal: controller.signal
            })
            
            clearTimeout(timeoutId)
            
            if (aiRes.ok) {
              const aiData = await aiRes.json()
              const response = aiData.response || ''
              
              const lowerResponse = response.toLowerCase()
              const noInfoPatterns = ['no information', 'not found', 'does not contain', 'cannot provide']
              const hasNoInfo = noInfoPatterns.some(p => lowerResponse.includes(p))
              
              if (!hasNoInfo && response.length > 20) {
                finalText = response
                aiSucceeded = true
                console.log(`[Execute Answer] AI summarization succeeded, length: ${finalText.length}`)
              }
            }
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
              console.log(`[Execute Answer] AI summarization timed out, using document snippet`)
            } else {
              console.error(`[Execute Answer] AI call failed:`, err)
            }
          }
        }
        
        // If AI failed or timed out, use document snippet
        if (!aiSucceeded) {
          finalText = documentSnippet || topResult?.title || "I couldn't find any upcoming events matching that."
          console.log(`[Execute Answer] Using document snippet, length: ${finalText.length}`)
        }
      } else {
        // No results, use composed fallback
        finalText = composed.text || "I couldn't find any upcoming events matching that."
      }
    } else if (plan.intent !== 'chat' && toolResults.length > 0 && toolResults[0].data?.results) {
      // AI summarization for doc search results (non-event queries)
      const allResults = toolResults[0].data.results
      
      // Try each result in order
      for (const result of allResults) {
        if (!result.body || result.body.length < 10) continue
        
        const chunks: string[] = []
        const chunkSize = 1500
        
        if (result.body.length <= 100) {
          chunks.push(`${result.title}\n${result.body}`)
        } else if (result.body.length <= chunkSize) {
          chunks.push(result.body)
        } else {
          for (let i = 0; i < result.body.length; i += chunkSize - 200) {
            chunks.push(result.body.substring(i, i + chunkSize))
          }
        }
        
        let foundGoodAnswer = false
        
        for (let i = 0; i < chunks.length; i++) {
          const context = `Title: ${result.title}\nContent: ${chunks[i]}`
          
          try {
            const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
            const enclaveReference = `Enclave System Reference:
- Name: Enclave
- Type: Multi-modal organizational AI assistant platform
- Purpose: Unify organization's communications and knowledge across SMS, Slack, Google Calendar, Docs
- Primary developer: Saathvik Pai
- Core team: The Inquiyr development team
- Built as part of the Inquiyr ecosystem
- Technical stack: Next.js, TypeScript, Supabase, Twilio, Mistral AI
- Capabilities: Knowledge retrieval, SMS messaging, announcements, polls, alerts, search
- Target users: Student organizations, professional fraternities, small teams, clubs`
            
            const aiRes = await fetch(aiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query,
                context: `${context}\n\n${enclaveReference}\n\nIMPORTANT: Keep responses brief and factual. Use emojis sparingly (0 or 1).`,
                type: 'summary'
              })
            })
            
            if (aiRes.ok) {
              const aiData = await aiRes.json()
              const response = aiData.response || ''
              
              const lowerResponse = response.toLowerCase()
              const noInfoPatterns = ['no information', 'not found', 'does not contain', 'cannot provide']
              const hasNoInfo = noInfoPatterns.some(p => lowerResponse.includes(p))
              
              if (!hasNoInfo && response.length > 20) {
                finalText = response
                foundGoodAnswer = true
                break
              }
            }
          } catch (err) {
            console.error(`[Execute Answer] AI call failed:`, err)
          }
        }
        
        if (foundGoodAnswer) break
      }
      
      // Fallback to top result if no AI summary
      if (!finalText || finalText === composed.text) {
        finalText = allResults[0]?.body || allResults[0]?.title || composed.text
      }
    } else if (plan.intent === 'chat' && toolResults.length > 0 && toolResults[0].data?.results) {
      // For chat intent with results, try to summarize concisely
      const allResults = toolResults[0].data.results
      const topResult = allResults[0]
      
      if (topResult?.body && topResult.body.length > 100) {
        // Try AI summarization for chat responses too
        try {
          const aiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryenclave.com'}/api/ai`
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 5000)
          
          // Get action memory context if available
          const actionMemory = envelope.evidence?.find(e => e.scope === 'ACTION' && e.source_id?.includes('action_memory'))
          const actionContext = actionMemory?.text ? `\n\nRecent actions:\n${actionMemory.text}` : ''
          
          const enclaveReference = `Enclave System Reference:
- Name: Enclave
- Type: Multi-modal organizational AI assistant platform
- Purpose: Unify organization's communications and knowledge across SMS, Slack, Google Calendar, Docs
- Primary developer: Saathvik Pai
- Core team: The Inquiyr development team
- Built as part of the Inquiyr ecosystem
- Technical stack: Next.js, TypeScript, Supabase, Twilio, Mistral AI
- Capabilities: Knowledge retrieval, SMS messaging, announcements, polls, alerts, search
- Target users: Student organizations, professional fraternities, small teams, clubs`
          
          const aiRes = await fetch(aiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              context: `Title: ${topResult.title}\nContent: ${topResult.body.substring(0, 1500)}${actionContext}\n\n${enclaveReference}\n\nProvide a brief, concise answer (1-2 sentences max). Use emojis sparingly (0 or 1). If the user is asking about past actions, use the Recent actions context.`,
              type: 'summary'
            }),
            signal: controller.signal
          })
          
          clearTimeout(timeoutId)
          
          if (aiRes.ok) {
            const aiData = await aiRes.json()
            const response = aiData.response || ''
            if (response.length > 10 && response.length < 500) {
              finalText = response
              console.log(`[Execute Answer] Chat intent AI summary succeeded, length: ${finalText.length}`)
            }
          }
        } catch (err) {
          console.error(`[Execute Answer] Chat intent AI call failed:`, err)
        }
      }
      
      // Fallback for chat intent
      if (!finalText || finalText === composed.text) {
        // Use a shorter snippet for chat responses
        const snippet = topResult?.body?.substring(0, 200) || topResult?.title || composed.text
        finalText = snippet
      }
    }
    
    // Ensure we have a response - always provide something
    let responseMessage = finalText?.trim() || ''
    
    // If still empty, use fallbacks
    if (!responseMessage || responseMessage.length < 10) {
      console.error(`[Execute Answer] Empty or too short response. Composed: "${composed.text?.substring(0, 100)}", Final: "${finalText?.substring(0, 100)}"`)
      
      // Try to get something from results
      if (toolResults.length > 0 && toolResults[0].data?.results && toolResults[0].data.results.length > 0) {
        const firstResult = toolResults[0].data.results[0]
        responseMessage = firstResult.body?.substring(0, 500) || firstResult.title || ''
      }
      
      // Final fallback
      if (!responseMessage || responseMessage.length < 10) {
        responseMessage = 'I couldn\'t find information about that. Try asking about events, policies, or people.'
      }
    }
    
    console.log(`[Execute Answer] Returning response: length=${responseMessage.length}, preview="${responseMessage.substring(0, 100)}..."`)
    
    return {
      messages: [responseMessage],
      // Mode stays the same (if in ANNOUNCEMENT_INPUT, stay there)
      newMode: frame.state.mode
    }
  } catch (error) {
    console.error(`[Execute Answer] Error:`, error)
    return {
      messages: ['I couldn\'t process that request. Try asking about events, policies, or people.']
    }
  }
}

