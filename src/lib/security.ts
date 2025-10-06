// Security utilities and validation functions
import { checkRateLimit } from './rate-limit'

export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return ''
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .slice(0, 1000) // Limit length
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function validateResourceTitle(title: string): { valid: boolean; error?: string } {
  if (!title || typeof title !== 'string') {
    return { valid: false, error: 'Title is required' }
  }
  
  const sanitized = sanitizeInput(title)
  if (sanitized.length < 1) {
    return { valid: false, error: 'Title cannot be empty' }
  }
  
  if (sanitized.length > 200) {
    return { valid: false, error: 'Title must be less than 200 characters' }
  }
  
  return { valid: true }
}

export function validateResourceDescription(description: string): { valid: boolean; error?: string } {
  if (!description || typeof description !== 'string') {
    return { valid: true } // Description is optional
  }
  
  const sanitized = sanitizeInput(description)
  if (sanitized.length > 5000) {
    return { valid: false, error: 'Description must be less than 5000 characters' }
  }
  
  return { valid: true }
}

export function validateTags(tags: string[]): { valid: boolean; error?: string } {
  if (!Array.isArray(tags)) {
    return { valid: false, error: 'Tags must be an array' }
  }
  
  if (tags.length > 10) {
    return { valid: false, error: 'Maximum 10 tags allowed' }
  }
  
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      return { valid: false, error: 'All tags must be strings' }
    }
    
    const sanitized = sanitizeInput(tag)
    if (sanitized.length < 1) {
      return { valid: false, error: 'Tag cannot be empty' }
    }
    
    if (sanitized.length > 50) {
      return { valid: false, error: 'Tag must be less than 50 characters' }
    }
  }
  
  return { valid: true }
}

export function rateLimitCheck(userId: string, action: 'SEARCH' | 'UPLOAD' | 'AI_REQUEST' | 'GOOGLE_DOCS' | 'GENERAL'): boolean {
  const result = checkRateLimit(userId, action)
  return result.allowed
}

export function validateFileUpload(file: File): { valid: boolean; error?: string } {
  const maxSize = 10 * 1024 * 1024 // 10MB
  const allowedTypes = [
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
  
  if (file.size > maxSize) {
    return { valid: false, error: 'File size must be less than 10MB' }
  }
  
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'File type not supported' }
  }
  
  return { valid: true }
}

export function validateGoogleFileId(fileId: string): { valid: boolean; error?: string } {
  if (!fileId || typeof fileId !== 'string') {
    return { valid: false, error: 'File ID is required' }
  }
  
  // Google file IDs should only contain alphanumeric characters, hyphens, and underscores
  if (!/^[a-zA-Z0-9-_]+$/.test(fileId)) {
    return { valid: false, error: 'Invalid file ID format' }
  }
  
  // Reasonable length limit
  if (fileId.length > 100) {
    return { valid: false, error: 'File ID too long' }
  }
  
  return { valid: true }
}

export function validateGoogleUrl(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' }
  }
  
  try {
    const parsedUrl = new URL(url)
    
    // Only allow Google Docs URLs
    if (!parsedUrl.hostname.includes('docs.google.com') && 
        !parsedUrl.hostname.includes('drive.google.com')) {
      return { valid: false, error: 'Only Google Docs and Google Drive URLs are supported' }
    }
    
    // Check for valid Google Docs patterns
    const validPatterns = [
      /\/document\/d\/[a-zA-Z0-9-_]+/,
      /\/spreadsheets\/d\/[a-zA-Z0-9-_]+/,
      /\/presentation\/d\/[a-zA-Z0-9-_]+/,
      /\/file\/d\/[a-zA-Z0-9-_]+/
    ]
    
    const hasValidPattern = validPatterns.some(pattern => pattern.test(parsedUrl.pathname))
    if (!hasValidPattern) {
      return { valid: false, error: 'Invalid Google Docs URL format' }
    }
    
    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }
}

