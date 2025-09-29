import { test, expect } from '@playwright/test'

test.describe('Search Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authenticated state
    await page.addInitScript(() => {
      window.localStorage.setItem('clerk-db-jwt', 'mock-jwt-token')
    })

    // Mock search API
    await page.route('**/api/search/hybrid**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              id: '1',
              title: 'Chapter Bylaws',
              body: 'Official chapter bylaws and constitution. Updated as of Fall 2024.',
              type: 'doc',
              url: 'https://example.com/bylaws',
              updated_at: '2024-09-26T00:00:00Z',
              source: 'upload',
              tags: [{ id: '1', name: 'bylaws' }],
            },
            {
              id: '2',
              title: 'Rush Week 2024',
              body: 'Annual recruitment week with various events and activities.',
              type: 'event',
              url: 'https://example.com/rush',
              updated_at: '2024-09-26T00:00:00Z',
              source: 'upload',
              tags: [{ id: '2', name: 'rush' }],
              event_meta: {
                start_at: '2024-09-15T03:00:00Z',
                location: 'Chapter House',
                cost: 'Free',
              },
            },
          ],
        }),
      })
    })

    // Mock AI API
    await page.route('**/api/ai**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: 'Based on the search results, here are the key findings...',
        }),
      })
    })
  })

  test('user can search for resources', async ({ page }) => {
    await page.goto('/')

    // Type search query
    const searchInput = page.getByPlaceholder('Ask about dues, events, or upload a resource...')
    await searchInput.fill('chapter bylaws')
    await searchInput.press('Enter')

    // Should show search results
    await expect(page.getByText('Chapter Bylaws')).toBeVisible()
    await expect(page.getByText('Official chapter bylaws and constitution')).toBeVisible()

    // Should show AI summary
    await expect(page.getByText('AI Assistant')).toBeVisible()
    await expect(page.getByText('Based on the search results, here are the key findings...')).toBeVisible()
  })

  test('user can click suggested prompts', async ({ page }) => {
    await page.goto('/')

    // Click on a suggested prompt
    await page.getByText('When is the next formal event?').click()

    // Should populate search input and trigger search
    const searchInput = page.getByPlaceholder('Ask about dues, events, or upload a resource...')
    await expect(searchInput).toHaveValue('When is the next formal event?')

    // Should show search results
    await expect(page.getByText('Rush Week 2024')).toBeVisible()
  })

  test('search results display correctly', async ({ page }) => {
    await page.goto('/')

    // Perform search
    const searchInput = page.getByPlaceholder('Ask about dues, events, or upload a resource...')
    await searchInput.fill('test query')
    await searchInput.press('Enter')

    // Check resource card styling
    const resourceCard = page.getByText('Chapter Bylaws').locator('..').locator('..')
    await expect(resourceCard).toHaveClass(/bg-panel/)
    await expect(resourceCard).toHaveClass(/border-line/)

    // Check tags
    await expect(page.getByText('doc')).toBeVisible()
    await expect(page.getByText('bylaws')).toBeVisible()

    // Check event metadata
    await expect(page.getByText('Sep 15, 2024 at 3:00 AM')).toBeVisible()
    await expect(page.getByText('Chapter House')).toBeVisible()
    await expect(page.getByText('Free')).toBeVisible()
  })

  test('user can open external links', async ({ page }) => {
    await page.goto('/')

    // Perform search
    const searchInput = page.getByPlaceholder('Ask about dues, events, or upload a resource...')
    await searchInput.fill('test query')
    await searchInput.press('Enter')

    // Click external link button
    const externalLinkButton = page.getByRole('button').filter({ hasText: '' }).first()
    await externalLinkButton.click()

    // Should open new tab (mocked)
    // In real test, you'd check for new page/tab
  })

  test('AI summary generates automatically', async ({ page }) => {
    await page.goto('/')

    // Perform search
    const searchInput = page.getByPlaceholder('Ask about dues, events, or upload a resource...')
    await searchInput.fill('test query')
    await searchInput.press('Enter')

    // Should show loading state initially
    await expect(page.getByText('AI is analyzing the results...')).toBeVisible()

    // Should show AI response automatically
    await expect(page.getByText('Based on the search results, here are the key findings...')).toBeVisible()

    // Should not show generate button
    await expect(page.getByText('Generate AI Summary')).not.toBeVisible()
  })

  test('handles empty search results', async ({ page }) => {
    // Mock empty search results
    await page.route('**/api/search/hybrid**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [] }),
      })
    })

    await page.goto('/')

    // Perform search
    const searchInput = page.getByPlaceholder('Ask about dues, events, or upload a resource...')
    await searchInput.fill('nonexistent query')
    await searchInput.press('Enter')

    // Should show no results message
    await expect(page.getByText('No results found')).toBeVisible()
  })

  test('handles search errors gracefully', async ({ page }) => {
    // Mock search API error
    await page.route('**/api/search/hybrid**', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Search failed' }),
      })
    })

    await page.goto('/')

    // Perform search
    const searchInput = page.getByPlaceholder('Ask about dues, events, or upload a resource...')
    await searchInput.fill('test query')
    await searchInput.press('Enter')

    // Should show error message
    await expect(page.getByText('Search failed')).toBeVisible()
  })
})
