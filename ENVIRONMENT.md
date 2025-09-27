## Environment Variables

Set these in your deployment environment (e.g., `.env.local`).

### Clerk Authentication
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: pk_test_ZW5hYmxlZC1ob3JuZXQtODIuY2xlcmsuYWNjb3VudHMuZGV2JA
- `CLERK_SECRET_KEY`: sk_test_UWkSmY5hGCKXMQYacy862XeHwGHNoHn9kueUDDWFvV

### Supabase
- `NEXT_PUBLIC_SUPABASE_URL`: https://igruzwyaohsbozlghihs.supabase.co
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
- `SUPABASE_SERVICE_ROLE_KEY`: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

### App Configuration
- `NEXT_PUBLIC_APP_URL`: http://localhost:3000

### AI (Mistral)
- `MISTRAL_API_KEY`: 39wvBRnpLprJvTPGn5ROiNwid1droiiR
- `MISTRAL_EMBED_MODEL` (optional): mistral-embed

This project centralizes environment access in `src/lib/env.ts`. Ensure all keys are set in your environment before running the app.
