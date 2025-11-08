// Simple in-memory cache for API responses
interface CacheEntry {
  data: any
  timestamp: number
  ttl: number
}

class SimpleCache {
  private cache = new Map<string, CacheEntry>()
  private maxSize = 100

  set(key: string, data: any, ttlMs = 5 * 60 * 1000) { // 5 minutes default
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      this.cache.delete(oldestKey)
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    })
  }

  get(key: string): any | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  clear() {
    this.cache.clear()
  }

  delete(key: string) {
    this.cache.delete(key)
  }
}

export const apiCache = new SimpleCache()

// Cache keys
export const CACHE_KEYS = {
  RESOURCES: 'resources',
  SEARCH: (query: string) => `search:${query}`,
  AI_RESPONSE: (query: string, context: string) => `ai:${query}:${context.slice(0, 50)}`
} as const











