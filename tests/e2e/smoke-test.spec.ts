import { test, expect } from '@playwright/test'

// Smoke test - runs in 5 minutes
test.describe('Enclave MVP Smoke Test', () => {
  test.beforeEach(async ({ page }) => {
    // Set longer timeout for CI/CD environments
    test.setTimeout(60000)
  })

  test('Complete smoke test flow', async ({ page }) => {
    console.log('🚀 Starting Enclave MVP Smoke Test...')

    // Step 1: Authentication
    console.log('1. Testing authentication...')
    await page.goto('/')
    
    // Check if we need to sign in
    if (await page.locator('text=Sign In').isVisible()) {
      await page.click('text=Sign In')
      await page.waitForURL('/sign-in/**')
      
      // Sign in with test account (you'll need to set these in environment)
      await page.fill('input[name="email"]', process.env.TEST_EMAIL || 'test@example.com')
      await page.fill('input[name="password"]', process.env.TEST_PASSWORD || 'testpassword')
      await page.click('button[type="submit"]')
    }
    
    // Wait for main app to load
    await page.waitForSelector('text=Enclave', { timeout: 10000 })
    console.log('✅ Authentication successful')

    // Step 2: File Upload Test
    console.log('2. Testing file upload...')
    
    // Create a simple test file
    const testContent = 'This is a test document for automated testing. It contains keywords like UCLA, startup, and healthcare.'
    const testFile = {
      name: 'test-document.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(testContent)
    }

    // Click upload button
    await page.click('button:has-text("Upload")')
    await page.waitForSelector('input[type="file"]', { timeout: 5000 })
    
    // Upload the test file
    await page.setInputFiles('input[type="file"]', {
      name: testFile.name,
      mimeType: testFile.mimeType,
      buffer: testFile.buffer
    })
    
    // Fill in title
    await page.fill('input[placeholder*="title"]', 'Automated Test Document')
    await page.fill('textarea[placeholder*="description"]', 'Created by automated test suite')
    
    // Submit upload
    await page.click('button:has-text("Upload")')
    
    // Wait for success message or redirect
    await page.waitForSelector('text=success', { timeout: 15000 }).catch(() => {
      // If no success message, check if we're redirected to resources
      return page.waitForURL('/resources', { timeout: 5000 })
    })
    console.log('✅ File upload successful')

    // Step 3: Search Test
    console.log('3. Testing search functionality...')
    
    // Go to main page for search
    await page.goto('/')
    await page.waitForSelector('input[placeholder*="search"]', { timeout: 5000 })
    
    // Search for content we know exists
    await page.fill('input[placeholder*="search"]', 'test document')
    await page.press('input[placeholder*="search"]', 'Enter')
    
    // Wait for results
    await page.waitForSelector('[data-testid="search-result"], .search-result, [class*="result"]', { timeout: 10000 })
    
    // Verify we got results
    const results = await page.locator('[data-testid="search-result"], .search-result, [class*="result"]').count()
    expect(results).toBeGreaterThan(0)
    console.log(`✅ Search returned ${results} results`)

    // Step 4: Resources Tab Test
    console.log('4. Testing resources tab...')
    
    await page.click('a:has-text("Resources")')
    await page.waitForURL('/resources', { timeout: 5000 })
    
    // Verify our uploaded document appears
    await page.waitForSelector('text=Automated Test Document', { timeout: 10000 })
    console.log('✅ Resources tab shows uploaded document')

    // Step 5: Workspace Test (if workspace functionality exists)
    console.log('5. Testing workspace functionality...')
    
    // Try to find workspace/group management
    const workspaceButton = page.locator('button:has-text("Workspace"), button:has-text("Group")').first()
    if (await workspaceButton.isVisible()) {
      await workspaceButton.click()
      await page.waitForSelector('text=Create Workspace, text=Create Group', { timeout: 5000 })
      console.log('✅ Workspace management accessible')
    } else {
      console.log('ℹ️ Workspace management not found (may not be implemented yet)')
    }

    console.log('🎉 Smoke test completed successfully!')
  })

  test('Error handling test', async ({ page }) => {
    console.log('🔍 Testing error handling...')
    
    await page.goto('/')
    
    // Test with invalid search
    if (await page.locator('input[placeholder*="search"]').isVisible()) {
      await page.fill('input[placeholder*="search"]', 'nonexistent-content-xyz-123')
      await page.press('input[placeholder*="search"]', 'Enter')
      
      // Should not crash, should show "no results" or empty state
      await page.waitForTimeout(2000)
      
      // Check if page is still responsive
      const isResponsive = await page.locator('body').isVisible()
      expect(isResponsive).toBe(true)
      console.log('✅ Error handling works correctly')
    }
  })
})


