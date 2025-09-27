-- Vector search RPC for Supabase (accepts float8[] and casts to vector)
CREATE OR REPLACE FUNCTION search_resources_vector(
  query_embedding float8[],
  target_space_id uuid,
  limit_count integer DEFAULT 20,
  offset_count integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  score float4
) AS $$
BEGIN
  RETURN QUERY
  SELECT r.id,
    -- Convert cosine distance to similarity (1 - distance)
    (1 - (re.embedding <=> (query_embedding::vector(1536))))::float4 AS score
  FROM resource_embedding re
  JOIN resource r ON r.id = re.resource_id
  WHERE r.space_id = target_space_id
  ORDER BY re.embedding <=> (query_embedding::vector(1536)) ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;


