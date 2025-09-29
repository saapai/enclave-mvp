import { NextRequest } from 'next/server'
import { POST as uploadHandler } from '@/app/api/upload/route'

// Mock Supabase
const mockSupabase = {
  from: jest.fn(() => ({
    insert: jest.fn(() => ({
      select: jest.fn(() => Promise.resolve({
        data: [{ id: 'new-resource-id' }],
        error: null,
      })),
    })),
  })),
}

jest.mock('@/lib/supabase', () => ({
  createClient: () => mockSupabase,
}))

// Mock Clerk
jest.mock('@clerk/nextjs', () => ({
  auth: () => Promise.resolve({
    userId: 'test-user-id',
  }),
}))

describe('/api/upload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a new resource successfully', async () => {
    const requestBody = {
      title: 'Test Resource',
      description: 'Test description',
      url: 'https://example.com',
      tags: ['test', 'example'],
    }

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const response = await uploadHandler(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.resourceId).toBe('new-resource-id')

    expect(mockSupabase.from).toHaveBeenCalledWith('resources')
  })

  it('validates required fields', async () => {
    const requestBody = {
      description: 'Test description',
      // Missing title
    }

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const response = await uploadHandler(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Title is required')
  })

  it('handles unauthenticated requests', async () => {
    // Mock Clerk to return no user
    jest.doMock('@clerk/nextjs', () => ({
      auth: () => Promise.resolve({
        userId: null,
      }),
    }))

    const requestBody = {
      title: 'Test Resource',
      description: 'Test description',
    }

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const response = await uploadHandler(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('handles database errors', async () => {
    mockSupabase.from.mockReturnValueOnce({
      insert: () => ({
        select: () => Promise.resolve({
          data: null,
          error: { message: 'Database error' },
        }),
      }),
    })

    const requestBody = {
      title: 'Test Resource',
      description: 'Test description',
    }

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const response = await uploadHandler(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to create resource')
  })

  it('validates URL format', async () => {
    const requestBody = {
      title: 'Test Resource',
      description: 'Test description',
      url: 'invalid-url',
    }

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const response = await uploadHandler(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid URL format')
  })
})
