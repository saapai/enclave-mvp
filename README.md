# Enclave MVP

A modern knowledge management system for teams and organizations with AI-powered search and Google Docs integration.

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment**
   ```bash
   cp env.example .env.local
   # Edit .env.local with your API keys
   ```

3. **Set up database**
   - Run SQL files in `database/` folder in Supabase SQL editor
   - Start with `supabase-setup.sql`

4. **Start development server**
   ```bash
   npm run dev
   ```

## Features

- **AI-Powered Search**: Semantic search with Mistral AI embeddings
- **Google Docs Integration**: Live sync with Google Docs
- **File Upload**: Support for PDFs, Word docs, images
- **Real-time Updates**: Webhook-based document synchronization
- **Access Control**: User-based permissions and space isolation

## Documentation

- [Database Setup](docs/DATABASE_SETUP.md)
- [Google Docs Integration](docs/GOOGLE_DOCS_SETUP.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Environment Setup](docs/ENVIRONMENT.md)

## API Endpoints

### Authentication
- `GET /api/oauth/google/start` - Start Google OAuth
- `GET /api/oauth/google/callback` - Google OAuth callback

### Google Docs
- `POST /api/google/docs/add` - Add Google Doc
- `GET /api/search/google-docs` - Search Google Docs

### General
- `POST /api/upload` - Upload files
- `GET /api/search/hybrid` - Hybrid search
- `POST /api/ai` - AI responses

## Tech Stack

- **Frontend**: Next.js 15, React, Tailwind CSS
- **Backend**: Next.js API routes
- **Database**: Supabase (PostgreSQL + pgvector)
- **AI**: Mistral AI (embeddings + chat)
- **Auth**: Clerk
- **Storage**: Supabase Storage
- **Google Integration**: Google APIs (Drive, Docs)

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## License

MIT# Force redeploy Wed Oct 29 04:13:07 PDT 2025
