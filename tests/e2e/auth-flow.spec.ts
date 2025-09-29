import { test, expect } from '@playwright/test'

test.describe('Authentication Flow', () => {
  test('user can sign in with Google', async ({ page }) => {
    await page.goto('/')

    // Should show sign-in card for unauthenticated user
    await expect(page.getByText('Welcome to Enclave')).toBeVisible()
    await expect(page.getByText('The answer layer for your chapter')).toBeVisible()

    // Click sign in button
    await page.getByRole('button', { name: 'Sign In' }).click()

    // Should navigate to sign-in page
    await expect(page).toHaveURL('/sign-in/clerk')
    await expect(page.getByText('Sign In')).toBeVisible()

    // Mock successful Google sign-in
    await page.route('**/api/auth/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    // Click Google sign-in button (if visible)
    const googleButton = page.getByText('Continue with Google')
    if (await googleButton.isVisible()) {
      await googleButton.click()
    }

    // Should redirect to main page after successful sign-in
    await expect(page).toHaveURL('/')
    await expect(page.getByText('Hello there!')).toBeVisible()
  })

  test('user can sign up with Google', async ({ page }) => {
    await page.goto('/sign-up')

    // Should show sign-up form
    await expect(page.getByText('Join Enclave')).toBeVisible()
    await expect(page.getByText('Create your account to get started')).toBeVisible()

    // Mock successful Google sign-up
    await page.route('**/api/auth/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    // Click Google sign-up button (if visible)
    const googleButton = page.getByText('Continue with Google')
    if (await googleButton.isVisible()) {
      await googleButton.click()
    }

    // Should redirect to main page after successful sign-up
    await expect(page).toHaveURL('/')
    await expect(page.getByText('Hello there!')).toBeVisible()
  })

  test('unauthenticated user sees welcome screen', async ({ page }) => {
    await page.goto('/')

    // Should show welcome screen
    await expect(page.getByText('Welcome to Enclave')).toBeVisible()
    await expect(page.getByText('The answer layer for your chapter')).toBeVisible()
    await expect(page.getByText('Please sign in to continue')).toBeVisible()

    // Should have sign in button
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()

    // Should have sign up link
    await expect(page.getByText('Don\'t have an account? Sign up')).toBeVisible()
  })

  test('authenticated user sees main interface', async ({ page }) => {
    // Mock authenticated state
    await page.addInitScript(() => {
      window.localStorage.setItem('clerk-db-jwt', 'mock-jwt-token')
    })

    await page.goto('/')

    // Should show main interface
    await expect(page.getByText('Hello there!')).toBeVisible()
    await expect(page.getByText('How can I help you today?')).toBeVisible()

    // Should show suggested prompts
    await expect(page.getByText('When is the next formal event?')).toBeVisible()
    await expect(page.getByText('How do I pay my chapter dues?')).toBeVisible()

    // Should show user avatar and name
    await expect(page.getByText('Add Resource')).toBeVisible()
  })
})

