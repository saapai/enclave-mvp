-- Resource text chunking support (run in Supabase SQL editor)

-- Ensure pgvector is available if you plan to store embeddings
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS resource_chunk (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_id UUID REFERENCES resource(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resource_chunk_resource_idx ON resource_chunk (resource_id);
CREATE INDEX IF NOT EXISTS resource_chunk_index_idx ON resource_chunk (resource_id, chunk_index);


