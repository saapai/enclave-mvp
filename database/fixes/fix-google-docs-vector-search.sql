-- Fix search_google_docs_vector to accept userId parameter
-- Same issue as calendar events - auth.uid() doesn't work with Clerk

DROP FUNCTION IF EXISTS search_google_docs_vector(vector, uuid, integer, integer);
DROP FUNCTION IF EXISTS search_google_docs_vector(vector, uuid, integer, integer, text);

CREATE OR REPLACE FUNCTION search_google_docs_vector(
  query_embedding VECTOR(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 10,
  offset_count INTEGER DEFAULT 0,
  target_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  source_id UUID,
  heading_path TEXT[],
  text TEXT,
  metadata JSONB,
  similarity FLOAT8,
  added_by TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gdc.id,
    gdc.source_id,
    gdc.heading_path,
    gdc.text,
    gdc.metadata,
    (1 - (gdc.embedding <=> query_embedding))::FLOAT8 AS similarity,
    sgd.added_by,
    gdc.created_at,
    gdc.updated_at
  FROM google_doc_chunks gdc
  JOIN sources_google_docs sgd ON gdc.source_id = sgd.id
  WHERE gdc.space_id = target_space_id
    AND (target_user_id IS NULL OR sgd.added_by = target_user_id)  -- Filter by user if provided
  ORDER BY gdc.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment
COMMENT ON FUNCTION search_google_docs_vector IS 'Vector similarity search for Google Doc chunks with optional user filtering (for Clerk auth)';




