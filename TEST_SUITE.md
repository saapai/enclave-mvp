# 🧪 Enclave MVP Comprehensive Test Suite

## 🎯 Purpose
This test suite ensures all core functionality works after any changes. Run these tests manually to verify the platform is working correctly.

---

## 🔧 Setup Tests

### 1. Database Migrations ✅
- [ ] Run `/database/fix-space-table-and-rls.sql`
- [ ] Run `/database/fix-app-user-rls.sql` 
- [ ] Run `/database/fix-resource-vector-search.sql`
- [ ] Run `/database/fix-fts-search-for-uploads.sql`

**Expected:** All SQL migrations complete without errors.

---

## 🔐 Authentication & User Management

### 2. User Registration & Login
- [ ] **Sign Up:** Create new account with email
- [ ] **Sign In:** Login with existing credentials
- [ ] **Sign Out:** Logout and verify session cleared
- [ ] **Profile:** User profile loads correctly

**Expected:** Smooth auth flow, no errors.

### 3. Workspace Management
- [ ] **Create Workspace:** Create new workspace with custom name
- [ ] **View Workspaces:** See list of user's workspaces
- [ ] **Default Workspace:** Default workspace exists and accessible
- [ ] **Workspace Persistence:** Workspaces persist after logout/login

**Expected:** Workspace creation works, no RLS errors.

---

## 📁 Resource Management

### 4. Manual File Upload
- [ ] **PDF Upload:** Upload a PDF file
  - [ ] File uploads successfully
  - [ ] Text extraction works (check logs for "Success - X chars")
  - [ ] File appears in resources tab
  - [ ] File has correct metadata (title, type, etc.)

- [ ] **Document Upload:** Upload .docx, .txt files
  - [ ] File uploads successfully  
  - [ ] Text extraction works
  - [ ] File appears in resources tab

- [ ] **Image Upload:** Upload .jpg, .png files
  - [ ] File uploads successfully
  - [ ] File appears in resources tab (OCR may not work yet)

**Expected:** All uploads work, text extraction successful, files visible in resources.

### 5. Google Docs Integration
- [ ] **Connect Google Account:** OAuth flow works
- [ ] **Add Google Doc:** Add a Google Doc to workspace
  - [ ] Doc appears in resources tab
  - [ ] Doc content is extracted and chunked
  - [ ] Doc is searchable

- [ ] **Google Doc Updates:** Edit the Google Doc
  - [ ] Changes are reflected (if webhook working)

**Expected:** Google Docs connect, sync, and appear in resources.

### 6. Google Calendar Integration  
- [ ] **Connect Calendar:** Calendar OAuth works
- [ ] **Calendar Events:** Events appear in search results
- [ ] **Event Details:** Event metadata (time, location) correct

**Expected:** Calendar events searchable and properly formatted.

---

## 🔍 Search Functionality

### 7. Keyword Search (FTS)
- [ ] **Exact Matches:** Search for exact words in documents
  - [ ] "UCLA" finds documents with "UCLA" 
  - [ ] "Inquiyr" finds startup documents
  - [ ] "HOSA" finds organization documents

**Expected:** Keyword search returns relevant results.

### 8. Semantic Search (Vector)
- [ ] **Conceptual Matches:** Search by meaning, not exact words
  - [ ] "resume" finds documents about career/experience
  - [ ] "startup" finds Inquiyr documents
  - [ ] "university" finds UCLA documents
  - [ ] "healthcare" finds HOSA documents

**Expected:** Semantic search finds conceptually related content.

### 9. Hybrid Search
- [ ] **Combined Results:** Search returns results from multiple sources
  - [ ] Manual uploads appear
  - [ ] Google Docs appear  
  - [ ] Calendar events appear
  - [ ] Results ranked by relevance

**Expected:** All content types appear in search results.

### 10. Search Filters
- [ ] **Workspace Filter:** Filter by specific workspace
- [ ] **Type Filter:** Filter by document type
- [ ] **Date Filter:** Filter by date range

**Expected:** Filters work and return appropriate subsets.

---

## 🗂️ Resource Organization

### 11. Resources Tab
- [ ] **Resource List:** All resources display correctly
- [ ] **Resource Details:** Click resource shows full content
- [ ] **Workspace Tags:** Resources show which workspace(s) they belong to
- [ ] **Resource Types:** Different types (doc, event, etc.) display correctly
- [ ] **Sorting:** Resources sort by date/relevance

**Expected:** Resources tab shows all user's content clearly.

### 12. Resource Management
- [ ] **Edit Resource:** Modify resource title/description
- [ ] **Delete Resource:** Remove resource
  - [ ] Single workspace: Resource deleted completely
  - [ ] Multiple workspaces: Prompt for which workspaces to remove from
- [ ] **Resource Persistence:** Resources persist after page reload

**Expected:** Resource CRUD operations work correctly.

---

## 🔗 Integration Tests

### 13. Cross-Workspace Functionality
- [ ] **Multi-Workspace Resource:** Upload resource to multiple workspaces
- [ ] **Workspace Switching:** Switch between workspaces
- [ ] **Resource Visibility:** Resources only visible in correct workspaces
- [ ] **Search Scoping:** Search within specific workspace vs. all workspaces

**Expected:** Workspace isolation and sharing work correctly.

### 14. Data Persistence
- [ ] **Logout/Login:** Data persists after logout and login
- [ ] **Page Refresh:** Data persists after browser refresh
- [ ] **Workspace Creation:** New workspaces persist
- [ ] **Resource Upload:** Uploaded resources persist

**Expected:** All data persists correctly across sessions.

---

## 🚨 Error Handling

### 15. Error Scenarios
- [ ] **Invalid File Types:** Try uploading unsupported files
- [ ] **Large Files:** Try uploading very large files
- [ ] **Network Issues:** Test with poor connectivity
- [ ] **Permission Errors:** Test with invalid permissions

**Expected:** Graceful error handling, user-friendly messages.

---

## 📊 Performance Tests

### 16. Load Testing
- [ ] **Multiple Uploads:** Upload several files quickly
- [ ] **Large Search Results:** Search returning many results
- [ ] **Concurrent Users:** Multiple users using system
- [ ] **Response Times:** Search and upload response times reasonable

**Expected:** System remains responsive under normal load.

---

## 🎯 Success Criteria

### ✅ All Tests Pass If:
1. **Authentication:** Users can sign up, login, logout
2. **Workspace Management:** Create, view, manage workspaces
3. **File Upload:** Upload PDFs, docs, images successfully
4. **Text Extraction:** PDF and document text extracted correctly
5. **Search:** Both keyword and semantic search work
6. **Google Integration:** Docs and Calendar connect and sync
7. **Resource Management:** View, edit, delete resources
8. **Data Persistence:** Everything persists across sessions
9. **Error Handling:** Graceful error messages
10. **Performance:** Reasonable response times

### 🚨 Critical Issues:
- **Upload Failures:** Files not uploading
- **Search Failures:** Search returning no results
- **Authentication Issues:** Users can't login
- **Data Loss:** Resources disappearing
- **RLS Errors:** Permission denied errors

---

## 🔄 Running the Test Suite

### Quick Smoke Test (5 minutes):
1. Login → Upload PDF → Search for content → Verify results

### Full Test Suite (30 minutes):
Run all tests above in order

### After Code Changes:
1. Run smoke test first
2. If smoke test passes, run full suite
3. If any test fails, investigate and fix before deploying

---

## 📝 Test Results Template

```
Date: ___________
Tester: ___________
Version: ___________

✅ PASSING:
- Authentication
- File Upload
- Search

❌ FAILING:
- Google Docs integration
- Error message on workspace creation

🚨 CRITICAL ISSUES:
- None

📊 PERFORMANCE:
- Search response time: ___ms
- Upload time: ___ms
- Page load time: ___ms
```

---

**Remember:** This test suite ensures the platform works end-to-end. Run it regularly to catch regressions!

