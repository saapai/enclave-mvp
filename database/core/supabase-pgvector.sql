-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Resource embeddings table
CREATE TABLE IF NOT EXISTS resource_embedding (
  resource_id UUID PRIMARY KEY REFERENCES resource(id) ON DELETE CASCADE,
  embedding VECTOR(1024),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for vector similarity (requires ANALYZE on large datasets)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS resource_embedding_ivfflat ON resource_embedding USING ivfflat (embedding vector_cosine_ops);
EXCEPTION WHEN OTHERS THEN
  -- Some managed Postgres instances may not allow ivfflat without additional settings
  RAISE NOTICE 'Skipping ivfflat index creation: %', SQLERRM;
END $$;


