-- Google Docs integration schema
-- Run this in your Supabase SQL editor

-- Google OAuth accounts
CREATE TABLE google_accounts (
  user_id UUID PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  google_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  access_token TEXT NOT NULL,     -- encrypt at rest
  refresh_token TEXT NOT NULL,    -- encrypt at rest
  token_expiry TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Google Docs sources
CREATE TABLE sources_google_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  google_file_id TEXT NOT NULL,
  google_doc_id TEXT NOT NULL,    -- same as fileId for Docs; kept for clarity
  title TEXT,
  mime_type TEXT,
  latest_revision_id TEXT,
  modified_time TIMESTAMPTZ,
  permissions_hash TEXT,
  added_by UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id, google_file_id)
);

-- Google Docs chunks (structure-aware)
CREATE TABLE google_doc_chunks (
  id BIGSERIAL PRIMARY KEY,
  space_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  source_id UUID NOT NULL REFERENCES sources_google_docs(id) ON DELETE CASCADE,
  heading_path TEXT[],
  text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1024),  -- Mistral embedding dimension
  chunk_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Google Drive push notification watches
CREATE TABLE gdrive_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_file_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  resource_id TEXT NOT NULL,          -- from X-Goog-Resource-Id header
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_google_accounts_user_id ON google_accounts(user_id);
CREATE INDEX idx_google_accounts_google_user_id ON google_accounts(google_user_id);
CREATE INDEX idx_sources_google_docs_space_id ON sources_google_docs(space_id);
CREATE INDEX idx_sources_google_docs_file_id ON sources_google_docs(google_file_id);
CREATE INDEX idx_google_doc_chunks_space_id ON google_doc_chunks(space_id);
CREATE INDEX idx_google_doc_chunks_source_id ON google_doc_chunks(source_id);
CREATE INDEX idx_google_doc_chunks_embedding ON google_doc_chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_gdrive_watches_expires ON gdrive_watches(expires_at);

-- RLS policies
ALTER TABLE google_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources_google_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_doc_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdrive_watches ENABLE ROW LEVEL SECURITY;

-- Google accounts: users can only access their own
CREATE POLICY "Users can access own google account" ON google_accounts
  FOR ALL USING (user_id = auth.uid());

-- Google docs sources: users can access docs in their spaces
CREATE POLICY "Users can access google docs in their spaces" ON sources_google_docs
  FOR ALL USING (
    space_id = '00000000-0000-0000-0000-000000000000' OR
    added_by = auth.uid()
  );

-- Google doc chunks: users can access chunks in their spaces
CREATE POLICY "Users can access google doc chunks in their spaces" ON google_doc_chunks
  FOR ALL USING (
    space_id = '00000000-0000-0000-0000-000000000000' OR
    source_id IN (
      SELECT id FROM sources_google_docs WHERE added_by = auth.uid()
    )
  );

-- Drive watches: users can access watches for their docs
CREATE POLICY "Users can access drive watches for their docs" ON gdrive_watches
  FOR ALL USING (
    google_file_id IN (
      SELECT google_file_id FROM sources_google_docs 
      WHERE space_id = '00000000-0000-0000-0000-000000000000' OR
            added_by = auth.uid()
    )
  );

-- Functions for Google Docs integration
CREATE OR REPLACE FUNCTION search_google_docs_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  source_id UUID,
  heading_path TEXT[],
  text TEXT,
  metadata JSONB,
  similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gdc.id,
    gdc.source_id,
    gdc.heading_path,
    gdc.text,
    gdc.metadata,
    1 - (gdc.embedding <=> query_embedding) AS similarity
  FROM google_doc_chunks gdc
  WHERE gdc.space_id = target_space_id
  ORDER BY gdc.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get Google Docs search results with permissions
CREATE OR REPLACE FUNCTION search_google_docs_with_permissions(
  search_query TEXT,
  target_space_id UUID,
  user_email TEXT,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  source_id UUID,
  heading_path TEXT[],
  text TEXT,
  metadata JSONB,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gdc.id,
    gdc.source_id,
    gdc.heading_path,
    gdc.text,
    gdc.metadata,
    ts_rank(to_tsvector('english', gdc.text), plainto_tsquery('english', search_query)) AS rank
  FROM google_doc_chunks gdc
  JOIN sources_google_docs sgd ON gdc.source_id = sgd.id
  WHERE gdc.space_id = target_space_id
    AND (
      -- Simple text search for now - permissions will be enforced at API level
      to_tsvector('english', gdc.text) @@ plainto_tsquery('english', search_query)
    )
  ORDER BY rank DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;
