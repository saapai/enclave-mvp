import { NextRequest } from 'next/server'
import { GET as searchHandler } from '@/app/api/search/hybrid/route'

// Mock Supabase
jest.mock('@/lib/supabase', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({
              data: [
                {
                  id: '1',
                  title: 'Test Resource',
                  body: 'Test content',
                  type: 'doc',
                  url: 'https://example.com',
                  updated_at: '2024-01-01T00:00:00Z',
                  source: 'upload',
                  tags: [{ id: '1', name: 'test' }],
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({
      data: [
        {
          id: '1',
          title: 'Test Resource',
          body: 'Test content',
          type: 'doc',
          url: 'https://example.com',
          updated_at: '2024-01-01T00:00:00Z',
          source: 'upload',
          tags: [{ id: '1', name: 'test' }],
          similarity: 0.95,
        },
      ],
      error: null,
    }),
  }),
}))

describe('/api/search/hybrid', () => {
  it('returns search results for valid query', async () => {
    const request = new NextRequest('http://localhost:3000/api/search/hybrid?q=test')
    
    const response = await searchHandler(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toHaveLength(1)
    expect(data.results[0]).toMatchObject({
      id: '1',
      title: 'Test Resource',
      body: 'Test content',
      type: 'doc',
    })
  })

  it('returns empty results for empty query', async () => {
    const request = new NextRequest('http://localhost:3000/api/search/hybrid?q=')
    
    const response = await searchHandler(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toHaveLength(0)
  })

  it('handles missing query parameter', async () => {
    const request = new NextRequest('http://localhost:3000/api/search/hybrid')
    
    const response = await searchHandler(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Query parameter is required')
  })

  it('handles database errors gracefully', async () => {
    // Mock Supabase error
    jest.doMock('@/lib/supabase', () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({
                  data: null,
                  error: { message: 'Database error' },
                }),
              }),
            }),
          }),
        }),
      }),
    }))

    const request = new NextRequest('http://localhost:3000/api/search/hybrid?q=test')
    
    const response = await searchHandler(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to search resources')
  })
})
