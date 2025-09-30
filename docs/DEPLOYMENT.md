# Deployment Guide

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Clerk Account**: Sign up at [clerk.com](https://clerk.com)
3. **Supabase Account**: Sign up at [supabase.com](https://supabase.com)
4. **Mistral AI Account**: Sign up at [mistral.ai](https://mistral.ai)

## Environment Variables

### Required Environment Variables

Copy `env.example` to `.env.local` and fill in the following:

```bash
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Supabase Database
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Mistral AI
MISTRAL_API_KEY=your_mistral_api_key_here

# Environment
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

### Vercel Environment Variables

In your Vercel dashboard, add these environment variables:

1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add each variable from the list above

## Database Setup

### Supabase Setup

1. Create a new Supabase project
2. Run the SQL migrations in `supabase/migrations/`
3. Enable Row Level Security (RLS) on all tables
4. Set up storage bucket for file uploads

### Required Tables

- `app_user` - User profiles
- `space` - Workspaces/chapters
- `resource` - Main resource storage
- `tag` - Tag system
- `resource_tag` - Resource-tag relationships
- `event_meta` - Event-specific metadata
- `query_log` - Search analytics

## Authentication Setup

### Clerk Configuration

1. Create a new Clerk application
2. Configure OAuth providers (Google, etc.)
3. Set up redirect URLs:
   - Development: `http://localhost:3000`
   - Production: `https://your-app.vercel.app`
4. Copy the publishable and secret keys

## AI Setup

### Mistral AI

1. Sign up for Mistral AI API access
2. Generate an API key
3. Add the key to your environment variables

## Deployment Steps

### 1. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### 2. Configure Domain (Optional)

1. Go to Vercel dashboard
2. Navigate to "Domains"
3. Add your custom domain
4. Update `NEXT_PUBLIC_APP_URL` in environment variables

### 3. Update Clerk Redirect URLs

1. Go to Clerk dashboard
2. Update redirect URLs to include your production domain
3. Test authentication flow

## Post-Deployment Checklist

- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] Authentication working
- [ ] File uploads working
- [ ] AI responses working
- [ ] Search functionality working
- [ ] Resources management working

## Monitoring

### Vercel Analytics

1. Enable Vercel Analytics in your dashboard
2. Add `NEXT_PUBLIC_VERCEL_ANALYTICS_ID` to environment variables

### Error Monitoring

Consider adding:
- Sentry for error tracking
- LogRocket for session replay
- Vercel Speed Insights for performance

## Security Considerations

- All API routes are protected with Clerk authentication
- Input validation and sanitization implemented
- Rate limiting on API endpoints
- File upload restrictions (size and type)
- SQL injection protection via Supabase
- XSS protection via input sanitization

## Performance Optimization

- Lazy loading for resource cards
- API response caching
- Image optimization via Next.js
- Bundle size optimization
- CDN via Vercel Edge Network

## Troubleshooting

### Common Issues

1. **Authentication not working**: Check Clerk redirect URLs
2. **Database errors**: Verify Supabase connection and RLS policies
3. **AI not responding**: Check Mistral API key and quota
4. **File uploads failing**: Verify Supabase storage bucket configuration

### Debug Mode

Set `NODE_ENV=development` to enable debug logging and detailed error messages.

## Scaling Considerations

- Database connection pooling
- Redis for session storage
- CDN for static assets
- Load balancing for high traffic
- Database read replicas for search queries

