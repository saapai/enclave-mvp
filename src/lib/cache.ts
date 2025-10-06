// Simple in-memory cache for API responses
interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<any>>()
  private cleanupInterval: NodeJS.Timeout

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000)
  }

  private cleanup() {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
      }
    }
  }

  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    })
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    const now = Date.now()
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
  }
}

// Global cache instance
const cache = new SimpleCache()

// Cache keys
export const CACHE_KEYS = {
  SEARCH_RESULTS: (query: string, spaceId: string, filters: any) => 
    `search:${spaceId}:${query}:${JSON.stringify(filters)}`,
  USER_GOOGLE_TOKENS: (userId: string) => `google_tokens:${userId}`,
  GOOGLE_DOC_METADATA: (fileId: string) => `gdoc_meta:${fileId}`,
  RESOURCE_EMBEDDING: (resourceId: string) => `embedding:${resourceId}`,
} as const

// Cache TTLs (in milliseconds)
export const CACHE_TTL = {
  SEARCH_RESULTS: 5 * 60 * 1000, // 5 minutes
  USER_GOOGLE_TOKENS: 10 * 60 * 1000, // 10 minutes
  GOOGLE_DOC_METADATA: 30 * 60 * 1000, // 30 minutes
  RESOURCE_EMBEDDING: 60 * 60 * 1000, // 1 hour
} as const

export { cache }

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    cache.destroy()
  })
}