-- Update vector dimensions from 1024 to 1536 for OpenAI embeddings
-- Run this in your Supabase SQL editor BEFORE re-embedding

-- Step 1: Clear existing embeddings (they're 1024-dim Mistral, incompatible)
TRUNCATE TABLE resource_embedding;
TRUNCATE TABLE resource_chunk;

-- Step 2: Update resource_embedding to 1536 dimensions
ALTER TABLE resource_embedding 
  ALTER COLUMN embedding TYPE vector(1536);

-- Step 3: Update resource_chunk to 1536 dimensions
ALTER TABLE resource_chunk 
  ALTER COLUMN embedding TYPE vector(1536);

-- Step 4: Update search_resources_vector to use dynamic dimensions
-- (Remove hardcoded ::vector(1024) cast)
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
    -- Use dynamic vector cast (Postgres infers dimension from column)
    (1 - (re.embedding <=> query_embedding::vector))::float4 AS score
  FROM resource_embedding re
  JOIN resource r ON r.id = re.resource_id
  WHERE r.space_id = target_space_id
  ORDER BY re.embedding <=> query_embedding::vector ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 5: Update search_resource_chunks_vector to use dynamic dimensions
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
         (1 - (rc.embedding <=> query_embedding::vector))::float4 AS score
  FROM resource_chunk rc
  JOIN resource r ON r.id = rc.resource_id
  WHERE r.space_id = target_space_id
    AND rc.embedding IS NOT NULL
  ORDER BY rc.embedding <=> query_embedding::vector ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 6: Update Google Docs vector search (if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'search_google_docs_vector'
  ) THEN
    EXECUTE '
      CREATE OR REPLACE FUNCTION search_google_docs_vector(
        query_embedding float8[],
        target_space_id uuid,
        limit_count integer DEFAULT 20,
        offset_count integer DEFAULT 0
      )
      RETURNS TABLE (
        source_id uuid,
        chunk_index integer,
        score float4
      ) AS $func$
      BEGIN
        RETURN QUERY
        SELECT gdc.source_id,
               gdc.chunk_index,
               (1 - (gdc.embedding <=> query_embedding::vector))::float4 AS score
        FROM google_doc_chunks gdc
        WHERE gdc.space_id = target_space_id
          AND gdc.embedding IS NOT NULL
        ORDER BY gdc.embedding <=> query_embedding::vector ASC
        LIMIT limit_count
        OFFSET offset_count;
      END;
      $func$ LANGUAGE plpgsql STABLE;
    ';
  END IF;
END $$;

-- Step 7: Update Calendar events vector search (if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'search_calendar_events_vector'
  ) THEN
    EXECUTE '
      CREATE OR REPLACE FUNCTION search_calendar_events_vector(
        query_embedding float8[],
        target_space_id uuid,
        limit_count integer DEFAULT 20,
        offset_count integer DEFAULT 0
      )
      RETURNS TABLE (
        event_id uuid,
        score float4
      ) AS $func$
      BEGIN
        RETURN QUERY
        SELECT ce.id AS event_id,
               (1 - (ce.embedding <=> query_embedding::vector))::float4 AS score
        FROM calendar_events ce
        WHERE ce.space_id = target_space_id
          AND ce.embedding IS NOT NULL
        ORDER BY ce.embedding <=> query_embedding::vector ASC
        LIMIT limit_count
        OFFSET offset_count;
      END;
      $func$ LANGUAGE plpgsql STABLE;
    ';
  END IF;
END $$;

-- Step 8: Verify changes
SELECT 
  'resource_embedding' as table_name,
  atttypmod as dimension
FROM pg_attribute
WHERE attrelid = 'resource_embedding'::regclass
  AND attname = 'embedding';

SELECT 
  'resource_chunk' as table_name,
  atttypmod as dimension
FROM pg_attribute
WHERE attrelid = 'resource_chunk'::regclass
  AND attname = 'embedding';

-- Expected output: dimension = 1536 for both tables


