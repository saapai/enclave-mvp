import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIResponse } from '@/components/ai-response'

// Mock fetch
const mockFetch = jest.fn()
global.fetch = mockFetch

describe('AIResponse Component', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  it('renders AI Assistant header', () => {
    render(
      <AIResponse
        query="test query"
        context="test context"
        type="summary"
      />
    )

    expect(screen.getByText('AI Assistant')).toBeInTheDocument()
    expect(screen.getByText('Powered by Mistral AI')).toBeInTheDocument()
  })

  it('auto-generates AI response on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: 'Test AI response' }),
    })

    render(
      <AIResponse
        query="test query"
        context="test context"
        type="summary"
      />
    )

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'test query',
          context: 'test context',
          type: 'summary',
        }),
      })
    })
  })

  it('shows loading state', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {})) // Never resolves

    render(
      <AIResponse
        query="test query"
        context="test context"
        type="summary"
      />
    )

    await waitFor(() => {
      expect(screen.getByText('AI is analyzing the results...')).toBeInTheDocument()
    })
  })

  it('displays AI response when received', async () => {
    const mockResponse = 'This is a test AI summary'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: mockResponse }),
    })

    render(
      <AIResponse
        query="test query"
        context="test context"
        type="summary"
      />
    )

    await waitFor(() => {
      expect(screen.getByText(mockResponse)).toBeInTheDocument()
    })
  })

  it('handles API errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('API Error'))

    render(
      <AIResponse
        query="test query"
        context="test context"
        type="summary"
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Failed to get AI response. Please try again.')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('allows regenerating response', async () => {
    const mockResponse = 'Initial response'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ response: mockResponse }),
    })

    const user = userEvent.setup()
    render(
      <AIResponse
        query="test query"
        context="test context"
        type="summary"
      />
    )

    await waitFor(() => {
      expect(screen.getByText(mockResponse)).toBeInTheDocument()
    })

    const regenerateButton = screen.getByText('Regenerate')
    await user.click(regenerateButton)

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
