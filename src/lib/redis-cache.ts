// Redis caching implementation for production
import { logger } from './logger'

interface RedisConfig {
  url?: string
  host?: string
  port?: number
  password?: string
  db?: number
}

class RedisCache {
  private client: any = null
  private isConnected = false
  private fallbackCache = new Map<string, { data: any; expiry: number }>()

  constructor() {
    this.initializeRedis()
  }

  private async initializeRedis() {
    try {
      // Try to import Redis client
      const Redis = await import('ioredis').catch(() => null)
      
      if (!Redis) {
        logger.warn('Redis not available, using in-memory fallback')
        return
      }

      const config: RedisConfig = {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0')
      }

      this.client = new Redis.default(config)
      
      this.client.on('connect', () => {
        this.isConnected = true
        logger.info('Redis connected successfully')
      })

      this.client.on('error', (error: Error) => {
        this.isConnected = false
        logger.error('Redis connection error', error)
      })

      this.client.on('disconnect', () => {
        this.isConnected = false
        logger.warn('Redis disconnected')
      })

    } catch (error) {
      logger.warn('Failed to initialize Redis', error as Error)
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.isConnected && this.client) {
        const data = await this.client.get(key)
        return data ? JSON.parse(data) : null
      } else {
        // Fallback to in-memory cache
        const item = this.fallbackCache.get(key)
        if (item && item.expiry > Date.now()) {
          return item.data
        }
        if (item) {
          this.fallbackCache.delete(key)
        }
        return null
      }
    } catch (error) {
      logger.error('Cache get error', error as Error, { key })
      return null
    }
  }

  async set<T>(key: string, data: T, ttlMs: number = 300000): Promise<boolean> {
    try {
      if (this.isConnected && this.client) {
        await this.client.setex(key, Math.ceil(ttlMs / 1000), JSON.stringify(data))
        return true
      } else {
        // Fallback to in-memory cache
        this.fallbackCache.set(key, {
          data,
          expiry: Date.now() + ttlMs
        })
        
        // Clean up expired items periodically
        if (this.fallbackCache.size > 1000) {
          this.cleanupFallbackCache()
        }
        
        return true
      }
    } catch (error) {
      logger.error('Cache set error', error as Error, { key })
      return false
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      if (this.isConnected && this.client) {
        const result = await this.client.del(key)
        return result > 0
      } else {
        return this.fallbackCache.delete(key)
      }
    } catch (error) {
      logger.error('Cache delete error', error as Error, { key })
      return false
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (this.isConnected && this.client) {
        const result = await this.client.exists(key)
        return result === 1
      } else {
        const item = this.fallbackCache.get(key)
        return item ? item.expiry > Date.now() : false
      }
    } catch (error) {
      logger.error('Cache exists error', error as Error, { key })
      return false
    }
  }

  async clear(): Promise<boolean> {
    try {
      if (this.isConnected && this.client) {
        await this.client.flushdb()
        return true
      } else {
        this.fallbackCache.clear()
        return true
      }
    } catch (error) {
      logger.error('Cache clear error', error as Error)
      return false
    }
  }

  async getStats(): Promise<{
    connected: boolean
    type: 'redis' | 'memory'
    size: number
    memoryUsage?: string
  }> {
    try {
      if (this.isConnected && this.client) {
        const info = await this.client.info('memory')
        const memoryUsage = info.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'unknown'
        
        return {
          connected: true,
          type: 'redis',
          size: 0, // Redis doesn't provide easy size count
          memoryUsage
        }
      } else {
        return {
          connected: false,
          type: 'memory',
          size: this.fallbackCache.size
        }
      }
    } catch (error) {
      logger.error('Cache stats error', error as Error)
      return {
        connected: false,
        type: 'memory',
        size: this.fallbackCache.size
      }
    }
  }

  private cleanupFallbackCache() {
    const now = Date.now()
    for (const [key, item] of this.fallbackCache.entries()) {
      if (item.expiry <= now) {
        this.fallbackCache.delete(key)
      }
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit()
      this.isConnected = false
    }
  }
}

// Global Redis cache instance
export const redisCache = new RedisCache()

// Cache keys and TTLs
export const CACHE_KEYS = {
  SEARCH_RESULTS: (query: string, spaceId: string, filters: any) => 
    `search:${spaceId}:${Buffer.from(query).toString('base64')}:${Buffer.from(JSON.stringify(filters)).toString('base64')}`,
  USER_GOOGLE_TOKENS: (userId: string) => `google_tokens:${userId}`,
  GOOGLE_DOC_METADATA: (fileId: string) => `gdoc_meta:${fileId}`,
  RESOURCE_EMBEDDING: (resourceId: string) => `embedding:${resourceId}`,
  HEALTH_CHECK: 'health:check',
  METRICS: (timeRange: string) => `metrics:${timeRange}`
} as const

export const CACHE_TTL = {
  SEARCH_RESULTS: 5 * 60 * 1000, // 5 minutes
  USER_GOOGLE_TOKENS: 10 * 60 * 1000, // 10 minutes
  GOOGLE_DOC_METADATA: 30 * 60 * 1000, // 30 minutes
  RESOURCE_EMBEDDING: 60 * 60 * 1000, // 1 hour
  HEALTH_CHECK: 30 * 1000, // 30 seconds
  METRICS: 60 * 1000 // 1 minute
} as const

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', async () => {
    await redisCache.disconnect()
  })
}