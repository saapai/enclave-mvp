// Rate limiting implementation
interface RateLimitEntry {
  count: number
  resetTime: number
}

class RateLimiter {
  private limits = new Map<string, RateLimitEntry>()
  private cleanupInterval: NodeJS.Timeout

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000)
  }

  private cleanup() {
    const now = Date.now()
    for (const [key, entry] of this.limits.entries()) {
      if (entry.resetTime < now) {
        this.limits.delete(key)
      }
    }
  }

  private getKey(identifier: string, action: string): string {
    return `${identifier}:${action}`
  }

  checkLimit(identifier: string, action: string, maxRequests: number, windowMs: number): boolean {
    const key = this.getKey(identifier, action)
    const now = Date.now()
    const entry = this.limits.get(key)

    if (!entry || entry.resetTime < now) {
      // Create new entry or reset expired one
      this.limits.set(key, {
        count: 1,
        resetTime: now + windowMs
      })
      return true
    }

    if (entry.count >= maxRequests) {
      return false
    }

    entry.count++
    return true
  }

  getRemainingRequests(identifier: string, action: string, maxRequests: number, windowMs: number): number {
    const key = this.getKey(identifier, action)
    const entry = this.limits.get(key)
    
    if (!entry || entry.resetTime < Date.now()) {
      return maxRequests
    }

    return Math.max(0, maxRequests - entry.count)
  }

  getResetTime(identifier: string, action: string): number | null {
    const key = this.getKey(identifier, action)
    const entry = this.limits.get(key)
    
    if (!entry || entry.resetTime < Date.now()) {
      return null
    }

    return entry.resetTime
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter()

// Rate limit configurations
export const RATE_LIMITS = {
  SEARCH: { maxRequests: 60, windowMs: 60 * 1000 }, // 60 requests per minute
  UPLOAD: { maxRequests: 10, windowMs: 60 * 1000 }, // 10 uploads per minute
  AI_REQUEST: { maxRequests: 30, windowMs: 60 * 1000 }, // 30 AI requests per minute
  GOOGLE_DOCS: { maxRequests: 20, windowMs: 60 * 1000 }, // 20 Google Docs operations per minute
  GENERAL: { maxRequests: 100, windowMs: 60 * 1000 } // 100 general requests per minute
} as const

export function checkRateLimit(
  identifier: string, 
  action: keyof typeof RATE_LIMITS
): { allowed: boolean; remaining: number; resetTime: number | null } {
  const config = RATE_LIMITS[action]
  const allowed = rateLimiter.checkLimit(identifier, action, config.maxRequests, config.windowMs)
  const remaining = rateLimiter.getRemainingRequests(identifier, action, config.maxRequests, config.windowMs)
  const resetTime = rateLimiter.getResetTime(identifier, action)

  return { allowed, remaining, resetTime }
}

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    rateLimiter.destroy()
  })
}