import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UploadDialog } from '@/components/upload-dialog'

// Mock fetch
const mockFetch = jest.fn()
global.fetch = mockFetch

describe('UploadDialog Component', () => {
  const mockOnOpenChange = jest.fn()

  beforeEach(() => {
    mockFetch.mockClear()
    mockOnOpenChange.mockClear()
  })

  it('renders upload dialog when open', () => {
    render(
      <UploadDialog open={true} onOpenChange={mockOnOpenChange} />
    )

    expect(screen.getByText('Upload New Resource')).toBeInTheDocument()
    expect(screen.getByLabelText('Title *')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
    expect(screen.getByLabelText('Link')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(
      <UploadDialog open={false} onOpenChange={mockOnOpenChange} />
    )

    expect(screen.queryByText('Upload New Resource')).not.toBeInTheDocument()
  })

  it('allows entering form data', async () => {
    const user = userEvent.setup()
    render(
      <UploadDialog open={true} onOpenChange={mockOnOpenChange} />
    )

    const titleInput = screen.getByLabelText('Title *')
    const descriptionInput = screen.getByLabelText('Description')
    const linkInput = screen.getByLabelText('Link')

    await user.type(titleInput, 'Test Resource')
    await user.type(descriptionInput, 'This is a test resource')
    await user.type(linkInput, 'https://example.com')

    expect(titleInput).toHaveValue('Test Resource')
    expect(descriptionInput).toHaveValue('This is a test resource')
    expect(linkInput).toHaveValue('https://example.com')
  })

  it('allows adding and removing tags', async () => {
    const user = userEvent.setup()
    render(
      <UploadDialog open={true} onOpenChange={mockOnOpenChange} />
    )

    const tagInput = screen.getByPlaceholderText('Type a tag and press Enter...')
    
    // Add a tag
    await user.type(tagInput, 'test-tag')
    await user.keyboard('{Enter}')

    expect(screen.getByText('test-tag')).toBeInTheDocument()

    // Remove the tag
    const removeButton = screen.getByRole('button', { name: /remove test-tag/i })
    await user.click(removeButton)

    expect(screen.queryByText('test-tag')).not.toBeInTheDocument()
  })

  it('submits form with correct data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    const user = userEvent.setup()
    render(
      <UploadDialog open={true} onOpenChange={mockOnOpenChange} />
    )

    // Fill form
    await user.type(screen.getByLabelText('Title *'), 'Test Resource')
    await user.type(screen.getByLabelText('Description'), 'Test description')
    await user.type(screen.getByPlaceholderText('Type a tag and press Enter...'), 'test-tag')
    await user.keyboard('{Enter}')

    // Submit
    const submitButton = screen.getByText('Upload Resource')
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Resource',
          description: 'Test description',
          url: '',
          tags: ['test-tag'],
        }),
      })
    })
  })

  it('handles submission errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Upload failed'))

    const user = userEvent.setup()
    render(
      <UploadDialog open={true} onOpenChange={mockOnOpenChange} />
    )

    await user.type(screen.getByLabelText('Title *'), 'Test Resource')
    await user.type(screen.getByLabelText('Description'), 'Test description')

    const submitButton = screen.getByText('Upload Resource')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/failed to upload/i)).toBeInTheDocument()
    })
  })

  it('closes dialog on successful submission', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    const user = userEvent.setup()
    render(
      <UploadDialog open={true} onOpenChange={mockOnOpenChange} />
    )

    await user.type(screen.getByLabelText('Title *'), 'Test Resource')
    await user.type(screen.getByLabelText('Description'), 'Test description')

    const submitButton = screen.getByText('Upload Resource')
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
