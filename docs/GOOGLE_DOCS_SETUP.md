# Google Docs Integration Setup

## Overview
This implementation provides live Google Docs integration with:
- OAuth authentication
- Structure-aware chunking
- Real-time webhook updates
- Vector search with embeddings
- Access control and permissions

## Setup Steps

### 1. Google Cloud Console Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable APIs:
   - Google Drive API
   - Google Docs API
   - Google People API (optional)

### 2. OAuth Client Configuration
1. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
2. Application type: "Web application"
3. **Authorized JavaScript origins** (no paths):
   - `http://localhost:3000` (development)
   - `https://yourdomain.com` (production)
4. **Authorized redirect URIs** (with paths):
   - `http://localhost:3000/api/oauth/google/callback` (development)
   - `https://yourdomain.com/api/oauth/google/callback` (production)

### 3. Environment Variables
Add to your `.env.local`:
```bash
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback
```

### 4. Database Setup
Run these SQL files in your Supabase SQL editor:
1. `google-docs-schema.sql` - Creates tables and indexes
2. `google-docs-functions.sql` - Creates helper functions

### 5. API Endpoints

#### OAuth Flow
- `GET /api/oauth/google/start` - Start OAuth flow
- `GET /api/oauth/google/callback` - OAuth callback

#### Google Docs Management
- `POST /api/google/docs/add` - Add a Google Doc
  ```json
  {
    "urlOrFileId": "https://docs.google.com/document/d/...",
    "spaceId": "optional-space-id"
  }
  ```

#### Search
- `GET /api/search/google-docs?q=query&limit=10` - Search Google Docs

#### Webhooks
- `POST /api/webhooks/google/drive` - Receives Google Drive notifications

## Usage Flow

### 1. Connect Google Account
```javascript
// Start OAuth flow
const response = await fetch('/api/oauth/google/start')
const { authUrl } = await response.json()
window.location.href = authUrl
```

### 2. Add Google Doc
```javascript
// Add a Google Doc
const response = await fetch('/api/google/docs/add', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    urlOrFileId: 'https://docs.google.com/document/d/1abc.../edit'
  })
})
const { success, source } = await response.json()
```

### 3. Search Google Docs
```javascript
// Search Google Docs
const response = await fetch('/api/search/google-docs?q=my search query')
const { results } = await response.json()
```

## Features

### Structure-Aware Chunking
- Splits documents by headings (H1, H2, H3, etc.)
- Preserves heading hierarchy in metadata
- Configurable chunk size (default: 1100 tokens)
- Overlap between chunks for context

### Real-Time Updates
- Google Drive push notifications
- Automatic re-indexing when documents change
- Webhook handling with proper validation

### Access Control
- Respects Google Drive permissions
- User-level access tokens
- Space-based isolation
- Permission hash validation

### Vector Search
- Mistral embeddings for semantic search
- Hybrid search (vector + text)
- Similarity scoring
- Source attribution

## Security Considerations

1. **Token Storage**: Access and refresh tokens are stored encrypted
2. **Permission Validation**: Always check Google Drive permissions
3. **Webhook Validation**: Verify channel IDs and resource IDs
4. **Rate Limiting**: Respect Google API quotas
5. **Access Control**: Enforce space-based permissions

## Monitoring

- Watch expiration (renew every 7 days)
- Failed webhook handling
- Token refresh failures
- Permission changes

## Troubleshooting

### Common Issues
1. **OAuth Errors**: Check redirect URI configuration
2. **Permission Denied**: Verify Google Drive API access
3. **Webhook Failures**: Check channel expiration
4. **Token Expired**: Implement automatic refresh

### Debugging
- Check browser console for OAuth errors
- Monitor server logs for API failures
- Verify database permissions
- Test webhook endpoints

## Next Steps

1. **UI Integration**: Add Google Docs picker to upload modal
2. **Bulk Import**: Support multiple documents at once
3. **Advanced Chunking**: Table and list-aware chunking
4. **Collaborative Features**: Real-time collaboration indicators
5. **Analytics**: Track document usage and search patterns
