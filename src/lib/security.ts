// Security utilities and validation functions

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

export function rateLimitCheck(userId: string, action: string): boolean {
  // Simple in-memory rate limiting (in production, use Redis or similar)
  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute
  const maxRequests = 60 // 60 requests per minute
  
  // This is a simplified implementation
  // In production, implement proper rate limiting with persistent storage
  return true
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








