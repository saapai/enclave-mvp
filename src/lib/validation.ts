import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from './logger'

// Common validation schemas
export const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  spaceId: z.string().uuid().optional(),
  type: z.enum(['event', 'doc', 'form', 'link', 'faq']).optional(),
  tags: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0)
})

export const aiRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  context: z.string().max(10000).optional(),
  type: z.enum(['summary', 'response', 'general']).default('summary')
})

export const googleDocsAddSchema = z.object({
  urlOrFileId: z.string().min(1).max(500),
  spaceId: z.string().uuid().optional()
})

export const uploadSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  type: z.enum(['event', 'doc', 'form', 'link', 'faq']),
  url: z.string().url().optional(),
  tags: z.string().optional(),
  spaceId: z.string().uuid().optional()
})

// Validation middleware factory
export function createValidationMiddleware<T>(schema: z.ZodSchema<T>) {
  return (handler: (req: NextRequest, validatedData: T) => Promise<NextResponse>) => {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        let data: any

        if (req.method === 'GET') {
          // For GET requests, validate query parameters
          const url = new URL(req.url)
          const params = Object.fromEntries(url.searchParams.entries())
          data = schema.parse(params)
        } else {
          // For POST/PUT requests, validate request body
          const body = await req.json()
          data = schema.parse(body)
        }

        return await handler(req, data)
      } catch (error) {
        if (error instanceof z.ZodError) {
          logger.warn('Validation error', { 
            errors: error.errors,
            path: req.url,
            method: req.method
          })
          
          return NextResponse.json(
            { 
              error: 'Validation failed',
              details: error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message
              }))
            },
            { status: 400 }
          )
        }

        logger.error('Validation middleware error', error as Error, {
          path: req.url,
          method: req.method
        })

        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        )
      }
    }
  }
}

// Helper function to validate file uploads
export function validateFileUpload(file: File): { valid: boolean; error?: string } {
  const maxSize = 10 * 1024 * 1024 // 10MB
  const allowedTypes = [
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]

  if (file.size > maxSize) {
    return { valid: false, error: 'File size must be less than 10MB' }
  }

  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'File type not supported' }
  }

  return { valid: true }
}

// Helper function to sanitize user input
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return ''
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .slice(0, 1000) // Limit length
}

// Helper function to validate UUIDs
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}