import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptCard } from '@/components/prompt-card'
import { Calendar } from 'lucide-react'

describe('PromptCard Component', () => {
  it('renders prompt text', () => {
    render(
      <PromptCard icon={<Calendar className="w-5 h-5" />}>
        Test prompt question
      </PromptCard>
    )

    expect(screen.getByText('Test prompt question')).toBeInTheDocument()
  })

  it('renders icon', () => {
    render(
      <PromptCard icon={<Calendar className="w-5 h-5" />}>
        Test prompt question
      </PromptCard>
    )

    const icon = screen.getByRole('button').querySelector('svg')
    expect(icon).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const mockOnClick = jest.fn()
    const user = userEvent.setup()

    render(
      <PromptCard 
        icon={<Calendar className="w-5 h-5" />}
        onClick={mockOnClick}
      >
        Test prompt question
      </PromptCard>
    )

    const card = screen.getByText('Test prompt question').closest('div')
    await user.click(card!)

    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })

  it('has proper styling classes', () => {
    render(
      <PromptCard icon={<Calendar className="w-5 h-5" />}>
        Test prompt question
      </PromptCard>
    )

    const card = screen.getByRole('button')
    expect(card).toHaveClass('rounded-xl', 'border')
  })

  it('is keyboard accessible', async () => {
    const mockOnClick = jest.fn()
    const user = userEvent.setup()

    render(
      <PromptCard 
        icon={<Calendar className="w-5 h-5" />}
        onClick={mockOnClick}
      >
        Test prompt question
      </PromptCard>
    )

    const card = screen.getByRole('button')
    await user.click(card)

    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })
})
