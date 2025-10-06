-- Performance optimization indexes for Enclave
-- Run this in your Supabase SQL editor

-- Additional indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_resource_source ON resource(source);
CREATE INDEX IF NOT EXISTS idx_resource_space_type_updated ON resource(space_id, type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_visibility ON resource(visibility);
CREATE INDEX IF NOT EXISTS idx_resource_created_at ON resource(created_at);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_resource_space_type_source ON resource(space_id, type, source);
CREATE INDEX IF NOT EXISTS idx_resource_space_updated_type ON resource(space_id, updated_at DESC, type);

-- Google Docs specific indexes
CREATE INDEX IF NOT EXISTS idx_google_doc_chunks_heading ON google_doc_chunks USING gin(heading_path);
CREATE INDEX IF NOT EXISTS idx_google_doc_chunks_created_at ON google_doc_chunks(created_at);
CREATE INDEX IF NOT EXISTS idx_google_doc_chunks_updated_at ON google_doc_chunks(updated_at);

-- Query log indexes for analytics
CREATE INDEX IF NOT EXISTS idx_query_log_user_id ON query_log(user_id);
CREATE INDEX IF NOT EXISTS idx_query_log_created_at ON query_log(created_at);
CREATE INDEX IF NOT EXISTS idx_query_log_space_user ON query_log(space_id, user_id);

-- Event meta indexes
CREATE INDEX IF NOT EXISTS idx_event_meta_start_at ON event_meta(start_at);
CREATE INDEX IF NOT EXISTS idx_event_meta_end_at ON event_meta(end_at);
CREATE INDEX IF NOT EXISTS idx_event_meta_location ON event_meta(location);

-- Resource tag indexes
CREATE INDEX IF NOT EXISTS idx_resource_tag_tag_id ON resource_tag(tag_id);
CREATE INDEX IF NOT EXISTS idx_resource_tag_resource_id ON resource_tag(resource_id);

-- App user indexes
CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user(email);
CREATE INDEX IF NOT EXISTS idx_app_user_space_role ON app_user(space_id, role);

-- Google accounts indexes
CREATE INDEX IF NOT EXISTS idx_google_accounts_email ON google_accounts(email);
CREATE INDEX IF NOT EXISTS idx_google_accounts_token_expiry ON google_accounts(token_expiry);

-- Drive watches indexes
CREATE INDEX IF NOT EXISTS idx_gdrive_watches_google_file_id ON gdrive_watches(google_file_id);
CREATE INDEX IF NOT EXISTS idx_gdrive_watches_created_at ON gdrive_watches(created_at);

-- Resource embedding indexes (if table exists)
CREATE INDEX IF NOT EXISTS idx_resource_embedding_updated_at ON resource_embedding(updated_at);

-- Resource chunk indexes (if table exists)
CREATE INDEX IF NOT EXISTS idx_resource_chunk_resource_id ON resource_chunk(resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_chunk_index ON resource_chunk(resource_id, chunk_index);

-- Analyze tables to update statistics
ANALYZE resource;
ANALYZE google_doc_chunks;
ANALYZE query_log;
ANALYZE event_meta;
ANALYZE resource_tag;
ANALYZE app_user;
ANALYZE google_accounts;
ANALYZE gdrive_watches;