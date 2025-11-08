/**
 * Preview Renderer
 * 
 * Renders draft preview respecting constraints.
 * If verbatim_only, shows exact text. Otherwise, assembles from slots.
 */

import { Draft } from './types'

/**
 * Render preview for announcement draft
 */
function renderAnnouncementPreview(draft: Draft): string {
  // If verbatim_only, return verbatim text exactly
  if (draft.constraints.verbatim_only && draft.verbatim) {
    return draft.verbatim
  }
  
  // Otherwise, assemble from slots
  const parts: string[] = []
  
  // Title (if present)
  if (draft.slots.title) {
    parts.push(draft.slots.title)
  }
  
  // Body
  if (draft.slots.body) {
    parts.push(draft.slots.body)
  }
  
  // Time
  if (draft.slots.time) {
    // Format time nicely (convert from ISO to readable)
    try {
      const [hours, minutes] = draft.slots.time.split(':')
      const hour = parseInt(hours)
      const ampm = hour >= 12 ? 'pm' : 'am'
      const hour12 = hour % 12 || 12
      parts.push(`at ${hour12}${minutes !== '00' ? `:${minutes}` : ''}${ampm}`)
    } catch (e) {
      parts.push(`at ${draft.slots.time}`)
    }
  }
  
  // Location
  if (draft.slots.location) {
    parts.push(`at ${draft.slots.location}`)
  }
  
  return parts.join(' ').trim()
}

/**
 * Render preview for poll draft
 */
function renderPollPreview(draft: Draft): string {
  const lines: string[] = []
  
  // Question
  if (draft.constraints.verbatim_only && draft.verbatim) {
    lines.push(draft.verbatim)
  } else if (draft.slots.question) {
    lines.push(draft.slots.question)
  } else {
    lines.push('[no question set]')
  }
  
  // Options
  if (draft.slots.options && draft.slots.options.length > 0) {
    lines.push('')
    draft.slots.options.forEach((opt, idx) => {
      lines.push(`${idx + 1}) ${opt}`)
    })
  } else {
    lines.push('')
    lines.push('1) Yes')
    lines.push('2) No')
  }
  
  return lines.join('\n')
}

/**
 * Main preview renderer
 */
export function renderPreview(draft: Draft): string {
  if (draft.type === 'poll') {
    return renderPollPreview(draft)
  }
  
  return renderAnnouncementPreview(draft)
}

/**
 * Render confirmation message with preview
 */
export function renderConfirmation(draft: Draft): string {
  const preview = renderPreview(draft)
  const verbatimNote = draft.constraints.verbatim_only ? ' (verbatim)' : ''
  
  return `Ready to send${verbatimNote}:\n\n${preview}\n\nReply "send it" to broadcast or "edit" to change`
}

/**
 * Render diff between old and new draft
 */
export function renderDiff(oldDraft: Draft, newDraft: Draft): string {
  const oldPreview = renderPreview(oldDraft)
  const newPreview = renderPreview(newDraft)
  
  if (oldPreview === newPreview) {
    return `No changes:\n\n${newPreview}`
  }
  
  return `Updated:\n\n${newPreview}\n\nReply "send it" to broadcast`
}


