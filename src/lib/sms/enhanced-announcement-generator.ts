/**
 * Enhanced Announcement Generator
 * 
 * Generates announcements while respecting:
 * - Verbatim text (exact wording)
 * - Instructions (e.g., "make sure to say it's at 9am")
 * - Constraints (must include, must not change)
 */

import { ENV } from '@/lib/env'
import { ParsedCommand } from './smart-command-parser'

export interface AnnouncementDraft {
  content: string
  time?: string
  date?: string
  location?: string
  audience?: string
  tone?: string
}

/**
 * Generate announcement draft with respect to constraints
 */
export async function generateAnnouncement(
  parsedCommand: ParsedCommand,
  previousDraft?: AnnouncementDraft
): Promise<AnnouncementDraft> {
  // If verbatim only, use exact text
  if (parsedCommand.constraints.verbatimOnly && parsedCommand.verbatimText) {
    return {
      content: parsedCommand.verbatimText,
      time: parsedCommand.extractedFields.time,
      date: parsedCommand.extractedFields.date,
      location: parsedCommand.extractedFields.location,
      audience: parsedCommand.extractedFields.audience || 'all',
      tone: parsedCommand.extractedFields.tone || 'casual'
    }
  }

  // If verbatim text provided but not verbatim-only, use it as base
  if (parsedCommand.verbatimText && !parsedCommand.needsGeneration) {
    return {
      content: parsedCommand.verbatimText,
      time: parsedCommand.extractedFields.time || previousDraft?.time,
      date: parsedCommand.extractedFields.date || previousDraft?.date,
      location: parsedCommand.extractedFields.location || previousDraft?.location,
      audience: parsedCommand.extractedFields.audience || previousDraft?.audience || 'all',
      tone: parsedCommand.extractedFields.tone || previousDraft?.tone || 'casual'
    }
  }
  
  // If editing and we have previous draft, preserve content unless explicitly changed
  if (previousDraft && previousDraft.content) {
    // Check if the edit is just updating time/date (not content)
    const isJustTimeDateUpdate = !parsedCommand.extractedFields.content || 
                                 parsedCommand.extractedFields.content.length < 10 ||
                                 parsedCommand.extractedFields.content.toLowerCase().includes('just say') ||
                                 parsedCommand.extractedFields.content.toLowerCase().includes('it\'s') ||
                                 parsedCommand.extractedFields.content.toLowerCase().includes('it is')
    
    if (isJustTimeDateUpdate) {
      // Preserve original content, just update time/date
      return {
        content: previousDraft.content,
        time: parsedCommand.extractedFields.time || previousDraft.time,
        date: parsedCommand.extractedFields.date || previousDraft.date,
        location: parsedCommand.extractedFields.location || previousDraft.location,
        audience: parsedCommand.extractedFields.audience || previousDraft.audience || 'all',
        tone: parsedCommand.extractedFields.tone || previousDraft.tone || 'casual'
      }
    }
  }

  // If we have minimal content, try to build a simple message directly
  // Check if content is just a simple topic (like "football") without much detail
  const contentLower = (parsedCommand.extractedFields.content || '').toLowerCase()
  const isSimpleTopic = parsedCommand.extractedFields.content && 
                       parsedCommand.extractedFields.content.length < 50 &&
                       !contentLower.includes('announcement') &&
                       !contentLower.includes('message') &&
                       !contentLower.includes('event')
  
  if (isSimpleTopic && !parsedCommand.needsGeneration && !parsedCommand.verbatimText) {
    // Build simple message from extracted fields
    let simpleMessage = parsedCommand.extractedFields.content
    
    // Add date first if present
    if (parsedCommand.extractedFields.date) {
      const dateObj = new Date(parsedCommand.extractedFields.date)
      const now = new Date()
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const isTomorrow = dateObj.toDateString() === tomorrow.toDateString()
      
      if (isTomorrow) {
        simpleMessage += ' is tomorrow'
      } else {
        simpleMessage += ` is on ${dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      }
    }
    
    // Add time if present
    if (parsedCommand.extractedFields.time) {
      const [hours, minutes] = parsedCommand.extractedFields.time.split(':')
      const hour24 = parseInt(hours)
      const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24
      const ampm = hour24 >= 12 ? 'pm' : 'am'
      const timeStr = `${hour12}:${minutes}${ampm}`
      simpleMessage += ` at ${timeStr}`
    }
    
    // Add location if present
    if (parsedCommand.extractedFields.location) {
      simpleMessage += ` at ${parsedCommand.extractedFields.location}`
    }
    
    return {
      content: simpleMessage,
      time: parsedCommand.extractedFields.time,
      date: parsedCommand.extractedFields.date,
      location: parsedCommand.extractedFields.location,
      audience: parsedCommand.extractedFields.audience || 'all',
      tone: parsedCommand.extractedFields.tone || 'casual'
    }
  }

  // Generate content using LLM with instructions
  if (parsedCommand.needsGeneration) {
    const generated = await generateWithLLM(parsedCommand, previousDraft)
    return generated
  }

  // Fallback: use extracted fields
  return {
    content: parsedCommand.extractedFields.content || 'Announcement',
    time: parsedCommand.extractedFields.time,
    date: parsedCommand.extractedFields.date,
    location: parsedCommand.extractedFields.location,
    audience: parsedCommand.extractedFields.audience || 'all',
    tone: parsedCommand.extractedFields.tone || 'casual'
  }
}

/**
 * Generate announcement using LLM with instructions
 */
async function generateWithLLM(
  parsedCommand: ParsedCommand,
  previousDraft?: AnnouncementDraft
): Promise<AnnouncementDraft> {
  try {
    const baseContent = parsedCommand.extractedFields.content || previousDraft?.content || ''
    const instructions = parsedCommand.instructions.join('. ')
    const mustInclude = parsedCommand.constraints.mustInclude.join(', ')

    // Build time/date context
    const timeInfo = parsedCommand.extractedFields.time ? 
      `Time: ${parsedCommand.extractedFields.time}` : ''
    const dateInfo = parsedCommand.extractedFields.date ? 
      `Date: ${parsedCommand.extractedFields.date}` : ''
    const locationInfo = parsedCommand.extractedFields.location ? 
      `Location: ${parsedCommand.extractedFields.location}` : ''

    const prompt = `Generate a simple, direct announcement message based ONLY on the information provided. Do NOT add extra details, emojis, marketing language, or invent event names.

What to announce: "${baseContent}"
${timeInfo ? timeInfo + '\n' : ''}${dateInfo ? dateInfo + '\n' : ''}${locationInfo ? locationInfo + '\n' : ''}${instructions ? `Additional instructions: ${instructions}\n` : ''}${mustInclude ? `Must include: ${mustInclude}\n` : ''}

Generate a brief, straightforward message (1-2 sentences). Use ONLY the information provided above. Do not invent details like event names, locations, descriptions, or emojis that weren't mentioned. Keep it simple and direct.`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)
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
            content: 'You are a helpful assistant that generates casual, friendly announcement messages for a college organization.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 300,
        stop: ['\n\n']
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Mistral API error: ${response.status}`)
    }

    const data = await response.json()
    const generatedContent = data.choices?.[0]?.message?.content?.trim() || baseContent

    return {
      content: generatedContent,
      time: parsedCommand.extractedFields.time || previousDraft?.time,
      date: parsedCommand.extractedFields.date || previousDraft?.date,
      location: parsedCommand.extractedFields.location || previousDraft?.location,
      audience: parsedCommand.extractedFields.audience || previousDraft?.audience || 'all',
      tone: parsedCommand.extractedFields.tone || previousDraft?.tone || 'casual'
    }
  } catch (err) {
    console.error('[EnhancedGenerator] LLM generation failed:', err)
    // Fallback to extracted fields
    return {
      content: parsedCommand.extractedFields.content || 'Announcement',
      time: parsedCommand.extractedFields.time,
      date: parsedCommand.extractedFields.date,
      location: parsedCommand.extractedFields.location,
      audience: parsedCommand.extractedFields.audience || 'all',
      tone: parsedCommand.extractedFields.tone || 'casual'
    }
  }
}

/**
 * Format announcement for preview/sending
 */
export function formatAnnouncement(draft: AnnouncementDraft): string {
  if (!draft || !draft.content) {
    return 'Announcement'
  }
  
  let message = draft.content.trim()

  // Add time if present
  if (draft.time && draft.time.trim().length > 0) {
    try {
      // Convert 24-hour to 12-hour for display
      const [hours, minutes] = draft.time.split(':')
      const hour24 = parseInt(hours)
      if (!isNaN(hour24)) {
        const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24
        const ampm = hour24 >= 12 ? 'pm' : 'am'
        const minStr = minutes || '00'
        const timeStr = `${hour12}:${minStr}${ampm}`
        message += ` (at ${timeStr})`
      }
    } catch (err) {
      // Skip time formatting if there's an error
    }
  }

  // Add location if present
  if (draft.location && draft.location.trim().length > 0) {
    message += ` at ${draft.location.trim()}`
  }

  return message
}

