## Requirements

### Runtime
- Node.js 18+ (Next.js 15 requires modern Node with fetch)
- npm (or pnpm/yarn)

### Install
```bash
npm install
```

### Environment variables
Set these (see `ENVIRONMENT.md` for example values):
- NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
- CLERK_SECRET_KEY
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- NEXT_PUBLIC_APP_URL
- MISTRAL_API_KEY
- (optional) MISTRAL_EMBED_MODEL, default: `mistral-embed`

### Supabase setup (run in SQL Editor)
1) Base schema and FTS function:
- `supabase-setup.sql`
- `supabase-search-function.sql`

2) Vector search (pgvector):
- `supabase-pgvector.sql`
- `supabase-vector-function.sql`

3) Storage bucket (one-time): `resources` (public). If `SUPABASE_SERVICE_ROLE_KEY` is set on the server, the upload API will auto-create this if missing.

### Reindex embeddings (optional but recommended)
After content is ingested, compute embeddings:
```bash
curl -X POST "http://localhost:3000/api/embeddings/reindex"
```

### Dependencies (package.json)

App/runtime deps:
- @clerk/nextjs ^6.32.2
- @radix-ui/react-dialog ^1.1.15
- @radix-ui/react-dropdown-menu ^2.1.16
- @radix-ui/react-select ^2.2.6
- @radix-ui/react-slot ^1.2.3
- @radix-ui/react-tabs ^1.1.13
- @radix-ui/react-toast ^1.2.15
- @supabase/auth-helpers-nextjs ^0.10.0
- @supabase/ssr ^0.7.0
- @supabase/supabase-js ^2.58.0
- class-variance-authority ^0.7.1
- clsx ^2.1.1
- lucide-react ^0.544.0
- next 15.5.4
- next-themes ^0.4.6
- react 19.1.0
- react-dom 19.1.0
- sonner ^2.0.7
- tailwind-merge ^3.3.1

Ingestion/AI deps:
- pdf-parse ^1.1.1
- mammoth ^1.8.0
- html-to-text ^9.0.5
- csv-parse ^5.5.6
- xlsx ^0.18.5
- tesseract.js ^5.1.0
- jszip ^3.10.1

Dev deps:
- @eslint/eslintrc ^3
- @tailwindcss/postcss ^4
- @types/node ^20
- @types/react ^19
- @types/react-dom ^19
- eslint ^9
- eslint-config-next 15.5.4
- tailwindcss ^4
- tw-animate-css ^1.4.0
- typescript ^5

### Notes
- OCR (tesseract.js) is WASM-based and works in serverless, but large images increase latency.
- Ensure `MISTRAL_API_KEY` is set; AI endpoints and embeddings use Mistral only.
- Run the SQL files in the order above. If pgvector index creation fails in your plan, the function still works with a sequential scan.

