-- Vector search over resource chunks (run after supabase-chunks.sql)
CREATE OR REPLACE FUNCTION search_resource_chunks_vector(
  query_embedding float8[],
  target_space_id uuid,
  limit_count integer DEFAULT 20,
  offset_count integer DEFAULT 0
)
RETURNS TABLE (
  resource_id uuid,
  chunk_index integer,
  score float4
) AS $$
BEGIN
  RETURN QUERY
  SELECT rc.resource_id,
         rc.chunk_index,
         (1 - (rc.embedding <=> (query_embedding::vector(1536))))::float4 AS score
  FROM resource_chunk rc
  JOIN resource r ON r.id = rc.resource_id
  WHERE r.space_id = target_space_id
    AND rc.embedding IS NOT NULL
  ORDER BY rc.embedding <=> (query_embedding::vector(1536)) ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;


