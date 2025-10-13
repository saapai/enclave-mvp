# Critical Fix: Google Doc Auto-Refresh Before Search

## Issue Identified
The Google Doc auto-refresh was happening **AFTER** the search query was processed, which meant users were always seeing stale data from Google Docs in their search results.

## Root Cause
In `src/app/page.tsx`, the `handleSearch` function was structured as:
1. Execute search query
2. Process results
3. **Then** check Google Docs for updates

This meant that even when Google Docs were updated, the search results were based on the old cached content.

## Solution Implemented
**Moved Google Doc refresh to happen BEFORE the search query execution:**

### Before (Wrong Order):
```typescript
const handleSearch = async () => {
  // 1. Execute search with potentially stale data
  const res = await fetch(`/api/search/hybrid?q=${query}`)
  
  // 2. Process results
  const searchResults = await res.json()
  
  // 3. THEN check Google Docs (too late!)
  await refreshGoogleDocs()
}
```

### After (Correct Order):
```typescript
const handleSearch = async () => {
  // 1. FIRST check Google Docs for updates
  await refreshGoogleDocs()
  
  // 2. THEN execute search with fresh data
  const res = await fetch(`/api/search/hybrid?q=${query}`)
  
  // 3. Process results with up-to-date content
  const searchResults = await res.json()
}
```

## Technical Details
- **File Modified**: `src/app/page.tsx`
- **Function**: `handleSearch`
- **Key Change**: Moved Google Doc refresh logic from line 225+ to line 167+
- **Console Logging**: Updated to show "BEFORE search" instead of "after search"

## Expected Behavior Now
1. User types "how many freshmen are there"
2. **First**: System checks all Google Docs for updates
3. **Then**: System executes search with fresh Google Doc content
4. **Result**: User sees current Google Doc data (e.g., "15 pledges and 5 freshmen")

## Testing
The fix ensures that:
- Google Docs are refreshed before every search query
- Search results reflect the most current Google Doc content
- Users don't need to manually refresh to see Google Doc updates
- The aggressive polling strategy now works correctly

## Impact
This is a **critical fix** that resolves the core issue where Google Doc changes weren't appearing in search results until after the search was already executed. Now users will always see the most up-to-date Google Doc content in their search results.

