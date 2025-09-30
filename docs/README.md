# Enclave MVP

**The answer layer for your chapter** - An AI-powered knowledge base and search platform for fraternity/sorority chapters.

## 🚀 Features

- **🔍 Intelligent Search**: Hybrid search combining keyword and semantic search with AI-powered summaries
- **📝 Resource Management**: Upload and organize documents, events, and information
- **🤖 AI Assistant**: Automatic AI summaries of search results powered by Mistral AI
- **🔐 Secure Authentication**: Google OAuth integration with Clerk
- **📱 Modern UI**: Clean, responsive design with dark theme
- **🏷️ Smart Tagging**: Organize resources with custom tags
- **📊 Event Management**: Track events with dates, locations, and costs

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Styling**: Tailwind CSS with custom design system
- **Authentication**: Clerk with Google OAuth
- **Database**: Supabase (PostgreSQL)
- **AI**: Mistral AI for intelligent summaries
- **Search**: Hybrid search with vector embeddings
- **Testing**: Jest, React Testing Library, Playwright

## 🏃‍♂️ Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account
- Clerk account
- Mistral AI API key

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/saapai/enclave-mvp.git
   cd enclave-mvp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Fill in your environment variables:
   ```env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # Clerk
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
   CLERK_SECRET_KEY=your_clerk_secret_key
   
   # Mistral AI
   MISTRAL_API_KEY=your_mistral_api_key
   ```

4. **Set up the database**
   ```bash
   # Run the SQL scripts in your Supabase dashboard
   # See supabase-chunks.sql and supabase-chunk-vector-function.sql
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### E2E Tests
```bash
npm run test:e2e
```

### Test Coverage
```bash
npm run test:coverage
```

## 📦 Deployment

### Vercel (Recommended)

1. **Connect your GitHub repository to Vercel**
2. **Set environment variables in Vercel dashboard**
3. **Deploy automatically on push to main**

### Manual Deployment

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Start the production server**
   ```bash
   npm start
   ```

## 🏗️ Project Structure

```
enclave-mvp/
├── src/
│   ├── app/                 # Next.js app directory
│   │   ├── api/            # API routes
│   │   ├── sign-in/        # Authentication pages
│   │   └── page.tsx        # Main application page
│   ├── components/         # React components
│   │   ├── ui/            # Reusable UI components
│   │   ├── ai-response.tsx # AI summary component
│   │   ├── prompt-card.tsx # Search prompt cards
│   │   └── upload-dialog.tsx # Resource upload modal
│   └── lib/               # Utility functions
├── tests/                 # Test files
│   ├── jest/             # Unit and integration tests
│   └── e2e/              # End-to-end tests
├── public/               # Static assets
└── supabase-*.sql        # Database setup scripts
```

## 🔧 Configuration

### Clerk Authentication

1. **Create a Clerk application**
2. **Enable Google OAuth**
3. **Set redirect URLs**:
   - Development: `http://localhost:3000`
   - Production: `https://your-domain.com`

### Supabase Setup

1. **Create a new Supabase project**
2. **Run the SQL scripts**:
   - `supabase-chunks.sql` - Creates the chunks table
   - `supabase-chunk-vector-function.sql` - Sets up vector search

### Mistral AI

1. **Get API key** from [Mistral AI](https://console.mistral.ai/)
2. **Add to environment variables**

## 🎨 Design System

The application uses a custom design system with:

- **Colors**: Blue/red gradient palette with dark theme
- **Typography**: Geist font family
- **Components**: Consistent spacing, shadows, and hover effects
- **Accessibility**: WCAG compliant with proper contrast ratios

## 📊 API Endpoints

- `GET /api/search/hybrid` - Hybrid search with AI summaries
- `POST /api/upload` - Upload new resources
- `POST /api/ai` - Generate AI summaries
- `GET /api/resources` - List all resources
- `POST /api/embeddings/reindex-chunks` - Reindex search vectors

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch**
3. **Make your changes**
4. **Add tests for new functionality**
5. **Submit a pull request**

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support, email [your-email@example.com] or create an issue on GitHub.

## 🗺️ Roadmap

- [ ] Advanced search filters
- [ ] Resource versioning
- [ ] User permissions and roles
- [ ] Mobile app
- [ ] Analytics dashboard
- [ ] Integration with chapter management systems

---

Built with ❤️ for Greek life communities