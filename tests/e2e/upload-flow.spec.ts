import { test, expect } from '@playwright/test'

test.describe('Upload Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authenticated state
    await page.addInitScript(() => {
      window.localStorage.setItem('clerk-db-jwt', 'mock-jwt-token')
    })

    // Mock upload API
    await page.route('**/api/upload**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, resourceId: 'new-resource-id' }),
      })
    })
  })

  test('user can open upload dialog', async ({ page }) => {
    await page.goto('/')

    // Click Add Resource button
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Should show upload dialog
    await expect(page.getByText('Add New Resource')).toBeVisible()
    await expect(page.getByLabel('Title')).toBeVisible()
    await expect(page.getByLabel('Description')).toBeVisible()
  })

  test('user can fill upload form', async ({ page }) => {
    await page.goto('/')

    // Open upload dialog
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Fill form fields
    await page.getByLabel('Title').fill('Test Resource')
    await page.getByLabel('Description').fill('This is a test resource description')
    await page.getByLabel('Link (optional)').fill('https://example.com')

    // Verify form values
    await expect(page.getByLabel('Title')).toHaveValue('Test Resource')
    await expect(page.getByLabel('Description')).toHaveValue('This is a test resource description')
    await expect(page.getByLabel('Link (optional)')).toHaveValue('https://example.com')
  })

  test('user can add and remove tags', async ({ page }) => {
    await page.goto('/')

    // Open upload dialog
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Add tags
    const tagInput = page.getByPlaceholder('Add tags...')
    await tagInput.fill('test-tag')
    await tagInput.press('Enter')

    await tagInput.fill('another-tag')
    await tagInput.press('Enter')

    // Verify tags are displayed
    await expect(page.getByText('test-tag')).toBeVisible()
    await expect(page.getByText('another-tag')).toBeVisible()

    // Remove a tag
    await page.getByRole('button', { name: /remove test-tag/i }).click()
    await expect(page.getByText('test-tag')).not.toBeVisible()
    await expect(page.getByText('another-tag')).toBeVisible()
  })

  test('user can submit upload form', async ({ page }) => {
    await page.goto('/')

    // Open upload dialog
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Fill form
    await page.getByLabel('Title').fill('Test Resource')
    await page.getByLabel('Description').fill('Test description')
    await page.getByPlaceholder('Add tags...').fill('test-tag')
    await page.getByPlaceholder('Add tags...').press('Enter')

    // Submit form
    await page.getByRole('button', { name: 'Upload Resource' }).click()

    // Should close dialog on success
    await expect(page.getByText('Add New Resource')).not.toBeVisible()
  })

  test('form validates required fields', async ({ page }) => {
    await page.goto('/')

    // Open upload dialog
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Try to submit without title
    await page.getByLabel('Description').fill('Test description')
    await page.getByRole('button', { name: 'Upload Resource' }).click()

    // Should show validation error
    await expect(page.getByText('Title is required')).toBeVisible()
  })

  test('form validates URL format', async ({ page }) => {
    await page.goto('/')

    // Open upload dialog
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Fill form with invalid URL
    await page.getByLabel('Title').fill('Test Resource')
    await page.getByLabel('Description').fill('Test description')
    await page.getByLabel('Link (optional)').fill('invalid-url')

    // Submit form
    await page.getByRole('button', { name: 'Upload Resource' }).click()

    // Should show validation error
    await expect(page.getByText('Invalid URL format')).toBeVisible()
  })

  test('handles upload errors gracefully', async ({ page }) => {
    // Mock upload API error
    await page.route('**/api/upload**', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Upload failed' }),
      })
    })

    await page.goto('/')

    // Open upload dialog
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Fill and submit form
    await page.getByLabel('Title').fill('Test Resource')
    await page.getByLabel('Description').fill('Test description')
    await page.getByRole('button', { name: 'Upload Resource' }).click()

    // Should show error message
    await expect(page.getByText('Failed to upload resource')).toBeVisible()
  })

  test('user can cancel upload', async ({ page }) => {
    await page.goto('/')

    // Open upload dialog
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Fill some data
    await page.getByLabel('Title').fill('Test Resource')
    await page.getByLabel('Description').fill('Test description')

    // Click cancel
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Should close dialog
    await expect(page.getByText('Add New Resource')).not.toBeVisible()
  })

  test('upload dialog is accessible', async ({ page }) => {
    await page.goto('/')

    // Open upload dialog
    await page.getByRole('button', { name: 'Add Resource' }).click()

    // Check for proper labels and roles
    await expect(page.getByLabel('Title')).toBeVisible()
    await expect(page.getByLabel('Description')).toBeVisible()
    await expect(page.getByLabel('Link (optional)')).toBeVisible()

    // Check for proper button roles
    await expect(page.getByRole('button', { name: 'Upload Resource' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })
})
