-- Hierarchical Chunking Schema
-- Multi-level document chunking: section → passage → sentence

-- ============================================================================
-- HIERARCHICAL CHUNKS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS hierarchical_chunk (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Source reference
  resource_id UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Hierarchy
  level TEXT NOT NULL CHECK (level IN ('section', 'passage', 'sentence')),
  parent_id UUID REFERENCES hierarchical_chunk(id) ON DELETE CASCADE,
  
  -- Position
  chunk_index INT NOT NULL,
  start_offset INT NOT NULL,
  end_offset INT NOT NULL,
  
  -- Content
  text TEXT NOT NULL,
  heading TEXT, -- Section heading (for section-level chunks)
  heading_path TEXT[], -- Full heading path (e.g., ['Chapter 1', 'Section 1.1'])
  
  -- Embedding
  embedding vector(1024),
  
  -- Metadata
  token_count INT,
  metadata JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS hierarchical_chunk_resource_id_idx ON hierarchical_chunk(resource_id);
CREATE INDEX IF NOT EXISTS hierarchical_chunk_space_id_idx ON hierarchical_chunk(space_id);
CREATE INDEX IF NOT EXISTS hierarchical_chunk_level_idx ON hierarchical_chunk(level);
CREATE INDEX IF NOT EXISTS hierarchical_chunk_parent_id_idx ON hierarchical_chunk(parent_id);
CREATE INDEX IF NOT EXISTS hierarchical_chunk_chunk_index_idx ON hierarchical_chunk(chunk_index);

-- Vector similarity search index
CREATE INDEX IF NOT EXISTS hierarchical_chunk_embedding_idx 
ON hierarchical_chunk 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- ============================================================================
-- SEARCH FUNCTION
-- ============================================================================

-- Search hierarchical chunks by vector similarity
CREATE OR REPLACE FUNCTION search_hierarchical_chunks(
  query_embedding vector(1024),
  space_id_param UUID,
  level_param TEXT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  resource_id UUID,
  level TEXT,
  parent_id UUID,
  text TEXT,
  heading TEXT,
  heading_path TEXT[],
  similarity FLOAT,
  start_offset INT,
  end_offset INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    hc.id,
    hc.resource_id,
    hc.level,
    hc.parent_id,
    hc.text,
    hc.heading,
    hc.heading_path,
    1 - (hc.embedding <=> query_embedding) AS similarity,
    hc.start_offset,
    hc.end_offset
  FROM hierarchical_chunk hc
  WHERE hc.space_id = space_id_param
    AND (level_param IS NULL OR hc.level = level_param)
    AND 1 - (hc.embedding <=> query_embedding) > match_threshold
  ORDER BY hc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get all children of a chunk
CREATE OR REPLACE FUNCTION get_chunk_children(chunk_id_param UUID)
RETURNS TABLE (
  id UUID,
  level TEXT,
  text TEXT,
  chunk_index INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    hc.id,
    hc.level,
    hc.text,
    hc.chunk_index
  FROM hierarchical_chunk hc
  WHERE hc.parent_id = chunk_id_param
  ORDER BY hc.chunk_index;
END;
$$ LANGUAGE plpgsql;

-- Get full context for a chunk (parent + siblings + children)
CREATE OR REPLACE FUNCTION get_chunk_context(chunk_id_param UUID)
RETURNS TABLE (
  chunk_id UUID,
  level TEXT,
  text TEXT,
  relation TEXT -- 'parent', 'self', 'sibling', 'child'
) AS $$
BEGIN
  RETURN QUERY
  WITH target AS (
    SELECT id, parent_id, level, text, chunk_index
    FROM hierarchical_chunk
    WHERE id = chunk_id_param
  )
  -- Parent
  SELECT 
    p.id,
    p.level,
    p.text,
    'parent'::TEXT
  FROM target t
  JOIN hierarchical_chunk p ON p.id = t.parent_id
  
  UNION ALL
  
  -- Self
  SELECT 
    t.id,
    t.level,
    t.text,
    'self'::TEXT
  FROM target t
  
  UNION ALL
  
  -- Siblings (same parent, nearby chunks)
  SELECT 
    s.id,
    s.level,
    s.text,
    'sibling'::TEXT
  FROM target t
  JOIN hierarchical_chunk s ON s.parent_id = t.parent_id
  WHERE s.id != t.id
    AND ABS(s.chunk_index - t.chunk_index) <= 2
  
  UNION ALL
  
  -- Children
  SELECT 
    c.id,
    c.level,
    c.text,
    'child'::TEXT
  FROM target t
  JOIN hierarchical_chunk c ON c.parent_id = t.id
  ORDER BY chunk_index;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE hierarchical_chunk IS 'Multi-level document chunks for precise retrieval';
COMMENT ON COLUMN hierarchical_chunk.level IS 'Chunk level: section (large), passage (medium), sentence (small)';
COMMENT ON COLUMN hierarchical_chunk.parent_id IS 'Parent chunk ID (passages belong to sections, sentences to passages)';
COMMENT ON COLUMN hierarchical_chunk.heading_path IS 'Full heading hierarchy for context';

