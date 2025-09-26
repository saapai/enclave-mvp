# Enclave v0.1 - Answer Layer for the Chapter

A knowledge management system for fraternity/sorority chapters that provides instant answers to common questions.

## Features

- **Instant Search**: Find answers to questions like "semi-formal bus time" or "dues form" in seconds
- **Resource Management**: Upload and organize events, documents, forms, links, and FAQs
- **Smart Tagging**: Categorize content with topic, logistics, and audience tags
- **Event Details**: Rich event information with dates, locations, costs, and dress codes
- **Query Logging**: Track what people are searching for to identify content gaps

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API routes
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Clerk
- **Search**: PostgreSQL Full-Text Search

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
cd enclave-mvp
npm install
```

### 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to Settings > API to get your project URL and anon key
3. Go to Settings > Database to get your service role key
4. Run the SQL schema from `schema.sql` in the Supabase SQL editor
5. Run the search function from `search-function.sql` in the Supabase SQL editor

### 3. Set up Clerk Authentication

1. Create a new application at [clerk.com](https://clerk.com)
2. Get your publishable key and secret key from the API Keys section

### 4. Environment Variables

Create a `.env.local` file in the root directory:

```env
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Database Schema

The application uses the following main tables:

- **space**: Chapter/house information
- **app_user**: User accounts with roles (member, curator, admin)
- **resource**: Content items (events, docs, forms, links, FAQs)
- **tag**: Categorization system
- **resource_tag**: Many-to-many relationship between resources and tags
- **event_meta**: Additional event-specific information
- **query_log**: Search query tracking
- **gap_alert**: Content gap detection

## Usage

### For Curators

1. **Upload Resources**: Click the "Upload" button to add new content
2. **Add Tags**: Use predefined tags or create new ones to categorize content
3. **Event Details**: For events, add dates, locations, costs, and dress codes
4. **Monitor Gaps**: Check the "Requests" tab for content gaps

### For Members

1. **Search**: Use the search bar to find information quickly
2. **Filter**: Use type and tag filters to narrow results
3. **View Details**: Click on resources to see full information
4. **Access Links**: Click external link buttons to open URLs

## Search Features

- **Full-Text Search**: Uses PostgreSQL's built-in search capabilities
- **Smart Ranking**: Boosts results based on relevance, freshness, and type intent
- **Type Intent**: Automatically boosts events for time-related queries and forms for application queries
- **Freshness Scoring**: Newer content ranks higher

## Roadmap

### v0.1 (Current)
- [x] Manual upload and tagging
- [x] Basic search functionality
- [x] User authentication
- [x] Resource management

### v0.2 (Next)
- [ ] Google Calendar integration
- [ ] Slack bot integration
- [ ] Gap alert system
- [ ] SMS notifications

### v0.3 (Future)
- [ ] Google Docs sync
- [ ] Advanced analytics
- [ ] Mobile app
- [ ] Multi-space support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details