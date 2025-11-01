# Enclave

AI-powered knowledge management system for organizations. Unify your communications and knowledge across SMS, Slack, Google Docs, and Calendar into a searchable, interactive AI assistant.

## ✨ Features

- **🔍 Intelligent Search**: Hybrid search combining keyword and semantic search with AI-powered summaries
- **📱 SMS Bot**: Conversational AI assistant via text messaging (queries, announcements, polls)
- **🤖 Multi-Modal Search**: Search across Google Docs, Slack, Calendar, and uploaded resources
- **📢 Announcements**: Send bulk SMS announcements to members
- **📊 Polls**: Create interactive SMS polls with real-time tracking
- **🔐 Secure**: Multi-tenant workspace isolation with role-based access
- **🤖 AI Assistant**: Automatic summaries powered by Mistral AI

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Supabase account
- Twilio account (for SMS)
- Mistral AI API key
- Clerk account (authentication)

### Installation

```bash
# Clone repository
git clone https://github.com/saapai/enclave-mvp.git
cd enclave-mvp

# Install dependencies
npm install

# Set up environment
cp env.example .env.local
# Edit .env.local with your API keys
```

### Environment Setup

Required environment variables (see `env.example` for full list):

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_key
CLERK_SECRET_KEY=your_clerk_secret

# Mistral AI
MISTRAL_API_KEY=your_mistral_key

# Twilio (for SMS)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
```

### Database Setup

1. Run SQL scripts in `database/` folder in Supabase SQL editor
2. Start with `supabase-setup.sql` for core tables
3. Run integration-specific schemas (SMS, Google, Slack)

### Running

```bash
# Development
npm run dev

# Production build
npm run build
npm start
```

## 📚 Documentation

**Full documentation**: See [docs/](./docs/) folder for comprehensive guides.

### Essential Documentation

- **[Canonical Documentation](./docs/CANONICAL_DOCUMENTATION.md)** - Complete feature reference (single source of truth)
- **[Setup Guide](./docs/README.md)** - Quick start and setup instructions
- **[SMS Bot Guide](./docs/SMS_COMPLETE_GUIDE.md)** - SMS bot usage and setup
- **[System Architecture](./docs/SYSTEM_ARCHITECTURE.md)** - Architecture overview
- **[Deployment](./docs/DEPLOYMENT.md)** - Deployment guide

### Quick Links

- [Environment Setup](./docs/ENVIRONMENT.md)
- [Database Setup](./docs/DATABASE_SETUP.md)
- [Google Docs Integration](./docs/GOOGLE_DOCS_SETUP.md)
- [Slack Integration](./docs/SLACK_INTEGRATION.md)

## 🏗️ Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes, serverless functions
- **Database**: Supabase (PostgreSQL + pgvector for embeddings)
- **AI**: Mistral AI (embeddings + chat completions)
- **Auth**: Clerk with Google OAuth
- **SMS**: Twilio
- **Integrations**: Google APIs (Docs, Drive, Calendar), Slack API

## 📱 SMS Bot Features

Send text messages to get instant answers:

- **Query**: "when is active meeting?", "what's happening this week?"
- **Announcements**: "I wanna make an announcement"
- **Polls**: "I wanna make a poll"
- **General**: Ask about policies, people, events, or documents

See [SMS Complete Guide](./docs/SMS_COMPLETE_GUIDE.md) for details.

## 🔧 Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Type checking
npm run type-check

# Linting
npm run lint
```

## 📂 Project Structure

```
enclave-mvp/
├── src/
│   ├── app/                  # Next.js app directory
│   │   ├── api/             # API routes
│   │   │   ├── twilio/      # SMS webhook handlers
│   │   │   ├── search/      # Search endpoints
│   │   │   ├── ai/          # AI summarization
│   │   │   └── oauth/       # Integration OAuth flows
│   │   ├── admin/           # Admin pages
│   │   └── sms-optin/       # SMS opt-in page
│   ├── components/          # React components
│   ├── lib/                 # Core modules
│   │   ├── search.ts        # Hybrid search
│   │   ├── planner.ts       # Query planning
│   │   ├── announcements.ts # SMS announcements
│   │   ├── polls.ts         # SMS polls
│   │   └── nlp/             # NLP utilities
│   └── workers/             # Background jobs
├── database/                # SQL migrations
├── docs/                    # Documentation
└── tests/                   # Test files
```

## 🧪 Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:coverage
```

## 🚢 Deployment

See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed deployment instructions.

Recommended deployment: Vercel
- Automatic deployments from GitHub
- Serverless function support
- Environment variable management

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📝 License

MIT License

## 🆘 Support

For issues or questions:
- Check the [documentation](./docs/README.md)
- Search existing GitHub issues
- Create a new issue with details

---

**Built with ❤️ for teams and organizations**
