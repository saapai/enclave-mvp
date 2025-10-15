# 24-Hour Launch Checklist for Enclave

## 🔴 CRITICAL (Must Do - 4-6 hours total)

### 1. Fix Manual Upload Search (30 min) ✓ In Progress
- [ ] Wait for debug logs from latest deployment
- [ ] Identify why FTS returns 0 hits for manual uploads
- [ ] Fix and deploy the solution
- [ ] Test: Upload resource → Query it → Should appear in top 3

### 2. Run SQL Migrations (5 min) 🚨 DO NOW
Run these in Supabase SQL Editor (in order):
```bash
1. /database/add-calendar-timezone-fields.sql
2. /database/fix-resource-created-by-type.sql  
3. /database/fix-google-docs-vector-search.sql
4. /database/fix-fts-search-for-uploads.sql
5. /database/fix-resource-vector-search.sql  ⚠️ CRITICAL FOR PDF SEMANTIC SEARCH
```

Test after each:
- [ ] Calendar events show correct times
- [ ] Manual uploads work with FTS (keyword search)
- [ ] Google Docs content appears in results
- [ ] PDF uploads are semantically searchable ⚠️ THIS FIXES RESUME SEARCH

### 3. Security & Rate Limiting (2 hours)
**Environment Variables:**
- [ ] `MISTRAL_API_KEY` - Set rate limits on Mistral dashboard
- [ ] `SUPABASE_SERVICE_ROLE_KEY` - Rotate if exposed
- [ ] `CLERK_SECRET_KEY` - Verify is secret
- [ ] Add `VERCEL_ENV=production` check

**API Route Protection:**
```typescript
// Add to all API routes
const rateLimiter = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string, maxRequests = 100, windowMs = 60000) {
  const now = Date.now()
  const userLimit = rateLimiter.get(userId)
  
  if (!userLimit || now > userLimit.resetAt) {
    rateLimiter.set(userId, { count: 1, resetAt: now + windowMs })
    return true
  }
  
  if (userLimit.count >= maxRequests) {
    return false
  }
  
  userLimit.count++
  return true
}
```

**Add to:**
- [ ] `/api/search/hybrid` - 100 req/min per user
- [ ] `/api/ai` - 50 req/min per user
- [ ] `/api/upload` - 20 req/min per user
- [ ] `/api/google/*` - 30 req/min per user

### 4. Error Handling & User Feedback (1 hour)
- [ ] Add user-friendly error messages (no stack traces to users)
- [ ] Add retry logic for failed API calls
- [ ] Add loading states for all async operations
- [ ] Add success/error toasts for all actions

### 5. Data Privacy & Compliance (1 hour)
- [ ] Verify RLS policies prevent cross-user data leakage
- [ ] Test: Create 2 accounts, ensure data is isolated
- [ ] Add data deletion endpoint (`DELETE /api/user/data`)
- [ ] Update privacy policy with data retention (currently 90 days)

### 6. Production Monitoring (30 min)
- [ ] Set up Vercel Analytics (free tier)
- [ ] Add Sentry for error tracking (or Vercel error tracking)
- [ ] Set up Supabase alerts for:
  - Database size > 80%
  - API errors > 1%
  - RLS policy violations

---

## 🟡 HIGH PRIORITY (Should Do - 2-3 hours)

### 7. Polish Critical User Flows (1.5 hours)
- [ ] Test complete user journey:
  1. Sign up → Connect Google → Add docs/calendar
  2. Upload manual resource
  3. Query and get good results
  4. Delete resources
  5. Sign out/back in
- [ ] Fix any UX friction found
- [ ] Add onboarding tooltips/tour

### 8. Performance Optimization (1 hour)
- [ ] Review Vercel function execution times
- [ ] Optimize slow queries (>500ms)
- [ ] Add caching headers for static assets
- [ ] Lazy load non-critical components

### 9. SEO & Meta Tags (30 min)
- [ ] Update `<title>` and meta descriptions
- [ ] Add Open Graph tags for social sharing
- [ ] Add favicon
- [ ] Create `robots.txt` and `sitemap.xml`

---

## 🟢 NICE TO HAVE (If Time - 1-2 hours)

### 10. Marketing Materials
- [ ] Screenshots for Product Hunt
- [ ] Demo video (Loom, 2 min max)
- [ ] Twitter thread prepared
- [ ] Launch post for LinkedIn

### 11. Documentation
- [ ] Update README with:
  - What it does
  - How to use it
  - Screenshots
  - FAQ
- [ ] Create `/docs` page on site

### 12. Analytics & Growth
- [ ] Add Plausible/PostHog for privacy-friendly analytics
- [ ] Track key events:
  - Sign ups
  - Resources added
  - Queries made
  - Google connections
- [ ] Add referral tracking

---

## 🚀 LAUNCH DAY CHECKLIST

### Pre-Launch (Morning)
- [ ] Final security audit
- [ ] Test all critical flows one more time
- [ ] Prepare rollback plan
- [ ] Set up status page (upptime.js free)

### Launch (Afternoon)
- [ ] Post on Product Hunt (time for 12:01 AM PST)
- [ ] Post on Twitter/X
- [ ] Post on LinkedIn
- [ ] Post in relevant subreddits (r/SideProject, r/IndieBiz)
- [ ] Post in Discord communities
- [ ] Email to beta users/friends

### Post-Launch (Evening)
- [ ] Monitor error logs every hour
- [ ] Respond to all feedback quickly
- [ ] Fix critical bugs immediately
- [ ] Thank early users publicly

---

## 📊 SUCCESS METRICS (First 24 Hours)

Track:
- Sign ups: Target 100+
- Google connections: 30%+ of users
- Queries made: 10+ per active user
- Error rate: <1%
- Uptime: 99.9%+

---

## 🆘 EMERGENCY CONTACTS

- **Vercel Support**: vercel.com/support
- **Supabase Support**: supabase.com/dashboard (support chat)
- **Clerk Support**: clerk.com/support
- **Mistral Support**: console.mistral.ai (check docs)

---

## 🔧 QUICK FIXES TO HAVE READY

**If search breaks:**
```typescript
// Fallback to simple text matching
const results = await supabase
  .from('resource')
  .select('*')
  .ilike('body', `%${query}%`)
  .limit(10)
```

**If AI breaks:**
```typescript
// Return search results without AI summary
return { results, aiResponse: "Here's what I found:" }
```

**If database hits limits:**
- Upgrade Supabase to Pro ($25/mo)
- Or implement aggressive caching

---

## ✅ FINAL PRE-LAUNCH TEST

Run this exact sequence:
1. ✅ Sign up new account
2. ✅ Connect Google account
3. ✅ Add Google Doc with content
4. ✅ Add Google Calendar
5. ✅ Upload manual file
6. ✅ Query something from each source
7. ✅ Verify all 3 sources appear in results
8. ✅ Delete resources
9. ✅ Re-add same resources (should work)
10. ✅ Sign out and sign in
11. ✅ Data still there and working

**If ALL 11 steps pass → SHIP IT! 🚢**

---

## 📈 POST-LAUNCH ITERATION PLAN

Week 1:
- Fix top 3 bugs users report
- Add most requested feature
- Optimize based on usage patterns

Week 2:
- Improve AI responses based on feedback
- Add integrations users want
- Scale infrastructure if needed

---

**Remember:** Perfect is the enemy of shipped. Focus on CRITICAL items, launch, then iterate based on real user feedback!


