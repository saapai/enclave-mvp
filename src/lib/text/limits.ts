export function smsTighten(s: string, max = 300): string {
  const oneLine = s.replace(/\s+\n/g, ' ').replace(/\n{2,}/g, '\n').trim()
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…'
}

/**
 * Split a long message into multiple SMS-friendly chunks
 * Tries to split at sentence boundaries to maintain readability
 */
export function splitLongMessage(message: string, maxLength: number = 1600): string[] {
  if (message.length <= maxLength) {
    return [message]
  }
  
  const messages: string[] = []
  let remaining = message
  
  while (remaining.length > maxLength) {
    // Find the last sentence boundary within maxLength
    let splitPoint = maxLength
    const searchText = remaining.substring(0, maxLength)
    
    // Try to find sentence endings (with space after, or at end of text)
    const periodWithSpace = searchText.lastIndexOf('. ')
    const periodAtEnd = searchText.endsWith('.') ? searchText.length - 1 : -1
    const lastPeriod = Math.max(periodWithSpace, periodAtEnd)
    
    const questionWithSpace = searchText.lastIndexOf('? ')
    const questionAtEnd = searchText.endsWith('?') ? searchText.length - 1 : -1
    const lastQuestion = Math.max(questionWithSpace, questionAtEnd)
    
    const exclamationWithSpace = searchText.lastIndexOf('! ')
    const exclamationAtEnd = searchText.endsWith('!') ? searchText.length - 1 : -1
    const lastExclamation = Math.max(exclamationWithSpace, exclamationAtEnd)
    
    const lastNewline = searchText.lastIndexOf('\n')
    
    // Use the latest sentence boundary (only if reasonable length to avoid tiny messages)
    const minBoundary = maxLength * 0.5
    const boundaries = [lastPeriod, lastNewline, lastQuestion, lastExclamation].filter(b => b >= minBoundary)
    
    if (boundaries.length > 0) {
      const bestBoundary = Math.max(...boundaries)
      // If boundary is period/question/exclamation with space after, split after the space
      // If boundary is at end of text, split after the punctuation
      if (periodWithSpace === bestBoundary || questionWithSpace === bestBoundary || exclamationWithSpace === bestBoundary) {
        splitPoint = bestBoundary + 2 // Skip punctuation and space
      } else {
        splitPoint = bestBoundary + 1 // Skip just the punctuation
      }
    } else {
      // No good boundary found - split at word boundary if possible
      const lastSpace = searchText.lastIndexOf(' ')
      if (lastSpace >= minBoundary) {
        splitPoint = lastSpace + 1
      }
      // Otherwise split at maxLength (better than truncating)
    }
    
    messages.push(remaining.substring(0, splitPoint).trim())
    remaining = remaining.substring(splitPoint).trim()
  }
  
  if (remaining.length > 0) {
    messages.push(remaining)
  }
  
  return messages
}



