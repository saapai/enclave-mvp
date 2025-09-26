#!/bin/bash

# Enclave MVP Environment Setup Script

echo "🚀 Setting up Enclave MVP environment..."

# Check if .env.local already exists
if [ -f ".env.local" ]; then
    echo "⚠️  .env.local already exists. Backing up to .env.local.backup"
    cp .env.local .env.local.backup
fi

# Create .env.local template
cat > .env.local << 'EOF'
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Mistral AI
MISTRAL_API_KEY=your_mistral_api_key

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF

echo "✅ Created .env.local template"
echo ""
echo "📝 Next steps:"
echo "1. Get your Clerk keys from https://clerk.com"
echo "2. Get your Supabase keys from https://supabase.com"
echo "3. Get your Mistral API key from https://mistral.ai"
echo "4. Update the .env.local file with your actual keys"
echo "5. Run the database setup:"
echo "   - Copy schema.sql content to Supabase SQL editor"
echo "   - Copy search-function.sql content to Supabase SQL editor"
echo "6. Run 'npm run dev' to start the development server"
echo ""
echo "🎉 Happy coding!"
