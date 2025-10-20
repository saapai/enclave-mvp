# 🧪 Automated Testing Guide

## 🚀 Quick Start

### Install Playwright
```bash
npm install
npm run test:install
```

### Run Tests

**Quick Smoke Test (5 minutes):**
```bash
npm run test:smoke
```

**Full Test Suite (30 minutes):**
```bash
npm run test:full
```

**Interactive UI Mode:**
```bash
npm run test:ui
```

**View Test Report:**
```bash
npm run test:report
```

---

## 📋 What Gets Tested

### ✅ Smoke Test (`npm run test:smoke`)
- Authentication flow
- File upload (PDF, documents)
- Search functionality (keyword + semantic)
- Resources tab display
- Workspace management

**When to run:** After every code change, before deploying

### ✅ Full Test Suite (`npm run test:full`)
- All smoke test items
- Google Docs integration
- Google Calendar integration
- Cross-workspace functionality
- Error handling
- Performance benchmarks
- Multi-browser testing

**When to run:** Before major releases, weekly

---

## 🔧 Configuration

### Environment Variables
Create `.env.local` with test credentials:

```bash
# Base URL
BASE_URL=http://localhost:3000

# Test user credentials
TEST_EMAIL=test@example.com
TEST_PASSWORD=testpassword123

# Supabase (same as production)
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key

# Clerk (same as production)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_key
CLERK_SECRET_KEY=your_secret
```

### Test Configuration
Edit `playwright.config.ts` to customize:
- Browsers to test
- Timeouts
- Retries
- Screenshots/videos
- Base URL

---

## 📊 Test Results

### View Results
After running tests:

```bash
npm run test:report
```

Opens HTML report at `http://localhost:9323`

### CI/CD Integration
```bash
npm run test:ci
```

Generates:
- `test-results.json` - JSON report
- `test-results.xml` - JUnit XML for CI
- Screenshots on failure
- Videos on failure

---

## 🐛 Debugging Tests

### Run Single Test
```bash
npx playwright test tests/e2e/smoke-test.spec.ts
```

### Run with UI
```bash
npm run test:ui
```

### Debug Mode
```bash
npx playwright test --debug
```

### View Trace
```bash
npx playwright show-trace trace.zip
```

---

## 📝 Writing New Tests

### Example Test
```typescript
import { test, expect } from '@playwright/test'

test('My new feature', async ({ page }) => {
  await page.goto('/')
  await page.click('button:has-text("New Feature")')
  await expect(page.locator('.result')).toBeVisible()
})
```

### Add to Test Suite
1. Create file in `tests/e2e/`
2. Follow naming: `feature-name.spec.ts`
3. Run: `npm run test`

---

## ✅ Success Criteria

### Smoke Test Must Pass:
- ✅ Login works
- ✅ File uploads successfully
- ✅ Search returns results
- ✅ Resources display correctly

### Full Suite Must Pass:
- ✅ All smoke test items
- ✅ All integrations work
- ✅ No errors in console
- ✅ Performance within limits

---

## 🚨 Troubleshooting

### Tests Fail Locally
1. Check if dev server is running: `npm run dev`
2. Check environment variables in `.env.local`
3. Clear browser cache: `npx playwright clean`
4. Reinstall browsers: `npm run test:install`

### Tests Pass Locally, Fail in CI
1. Check CI environment variables
2. Check timeout settings
3. Review CI logs for specific errors
4. Run `npm run test:ci` locally

### Flaky Tests
1. Increase timeouts in `playwright.config.ts`
2. Add explicit waits: `await page.waitForSelector()`
3. Use `test.setTimeout()` for slow tests
4. Check for race conditions

---

## 📚 Resources

- [Playwright Docs](https://playwright.dev)
- [Test Suite Documentation](./TEST_SUITE.md)
- [Smoke Test Checklist](./SMOKE_TEST.md)

---

**Remember:** Run smoke tests before every deploy! 🚀

