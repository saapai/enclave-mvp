-- Create the search function for full-text search with ranking
CREATE OR REPLACE FUNCTION search_resources(
  search_query TEXT,
  space_id UUID,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  space_id UUID,
  type TEXT,
  title TEXT,
  body TEXT,
  url TEXT,
  source TEXT,
  visibility TEXT,
  created_by UUID,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  rank REAL,
  score REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.space_id,
    r.type,
    r.title,
    r.body,
    r.url,
    r.source,
    r.visibility,
    r.created_by,
    r.updated_at,
    r.created_at,
    ts_rank_cd(
      to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, '')),
      plainto_tsquery('english', search_query)
    ) as rank,
    -- Calculate composite score with boosts
    (
      ts_rank_cd(
        to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, '')),
        plainto_tsquery('english', search_query)
      ) * 
      -- Freshness boost
      exp(-EXTRACT(EPOCH FROM (NOW() - r.updated_at)) / (60 * 60 * 24 * 60)) *
      -- Type intent boost
      CASE 
        WHEN r.type = 'event' AND (
          search_query ILIKE '%when%' OR 
          search_query ILIKE '%where%' OR 
          search_query ILIKE '%time%' OR 
          search_query ILIKE '%date%'
        ) THEN 1.4
        WHEN r.type = 'form' AND (
          search_query ILIKE '%form%' OR 
          search_query ILIKE '%apply%' OR 
          search_query ILIKE '%submit%' OR 
          search_query ILIKE '%register%'
        ) THEN 1.4
        ELSE 1.0
      END
    ) as score
  FROM resource r
  WHERE r.space_id = search_resources.space_id
    AND to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.body, '')) 
        @@ plainto_tsquery('english', search_query)
  ORDER BY score DESC, rank DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;
