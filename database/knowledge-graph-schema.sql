-- Knowledge Graph Schema
-- Structured knowledge layer for Enclave to enable Poke-like responses
-- Created: 2025-10-28

-- ============================================================================
-- EVENTS TABLE
-- ============================================================================
-- Stores structured event information extracted from documents/Slack/Calendar
CREATE TABLE IF NOT EXISTS event (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Core event info
  name TEXT NOT NULL,
  series_slug TEXT, -- canonical slug: 'big-little', 'ad-ag-summons', 'active-meeting'
  description TEXT,
  
  -- Timing
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  rrule TEXT, -- recurrence rule (e.g., 'FREQ=WEEKLY;BYDAY=WE')
  timezone TEXT DEFAULT 'America/Los_Angeles',
  
  -- Location
  location TEXT,
  location_details JSONB, -- {address, room, building, coordinates}
  
  -- People
  hosts TEXT[], -- array of person names/IDs
  required BOOLEAN DEFAULT FALSE, -- mandatory attendance?
  
  -- Provenance (where this info came from)
  source_type TEXT, -- 'doc', 'slack', 'calendar', 'manual'
  source_id UUID, -- resource_id, slack_message_id, calendar_event_id
  chunk_id UUID, -- specific chunk if from doc
  start_offset INT, -- character offset in source
  end_offset INT,
  
  -- Metadata
  confidence FLOAT DEFAULT 1.0, -- extraction confidence (0-1)
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Event aliases for flexible matching
CREATE TABLE IF NOT EXISTS event_alias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  alias TEXT NOT NULL, -- 'big little', 'Big/Little', 'B/L'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS event_space_id_idx ON event(space_id);
CREATE INDEX IF NOT EXISTS event_series_slug_idx ON event(series_slug);
CREATE INDEX IF NOT EXISTS event_start_at_idx ON event(start_at);
CREATE INDEX IF NOT EXISTS event_name_trgm_idx ON event USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS event_alias_alias_idx ON event_alias(alias);
CREATE INDEX IF NOT EXISTS event_alias_event_id_idx ON event_alias(event_id);

-- ============================================================================
-- POLICIES/PROGRAMS TABLE
-- ============================================================================
-- Stores structured policy/program information
CREATE TABLE IF NOT EXISTS policy (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Core info
  title TEXT NOT NULL,
  slug TEXT, -- canonical slug: 'study-hall-rules', 'dress-code'
  summary TEXT,
  bullets TEXT[], -- key points as array
  
  -- Metadata
  audience TEXT, -- 'pledges', 'actives', 'all'
  category TEXT, -- 'academic', 'social', 'professional', 'administrative'
  effective_date DATE,
  
  -- Provenance
  source_type TEXT,
  source_id UUID,
  chunk_id UUID,
  start_offset INT,
  end_offset INT,
  
  -- Metadata
  confidence FLOAT DEFAULT 1.0,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS policy_space_id_idx ON policy(space_id);
CREATE INDEX IF NOT EXISTS policy_slug_idx ON policy(slug);
CREATE INDEX IF NOT EXISTS policy_title_trgm_idx ON policy USING gin(title gin_trgm_ops);

-- ============================================================================
-- PEOPLE TABLE
-- ============================================================================
-- Stores information about people in the organization
CREATE TABLE IF NOT EXISTS person (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Core info
  name TEXT NOT NULL,
  role TEXT, -- 'president', 'pledge educator', 'member'
  email TEXT,
  phone TEXT,
  handles JSONB, -- {slack: '@username', instagram: '@handle'}
  
  -- Metadata
  org TEXT,
  class TEXT, -- 'fall 2024', '2025'
  
  -- Provenance
  source_type TEXT,
  source_id UUID,
  chunk_id UUID,
  start_offset INT,
  end_offset INT,
  
  -- Metadata
  confidence FLOAT DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS person_space_id_idx ON person(space_id);
CREATE INDEX IF NOT EXISTS person_name_trgm_idx ON person USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS person_role_idx ON person(role);

-- ============================================================================
-- FACTS TABLE
-- ============================================================================
-- Stores atomic knowledge triples for flexible querying
CREATE TABLE IF NOT EXISTS fact (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Triple structure: subject-predicate-object
  kind TEXT NOT NULL, -- 'property', 'relationship', 'attribute'
  subject TEXT NOT NULL, -- 'Big Little Appreciation'
  predicate TEXT NOT NULL, -- 'happens_on'
  object TEXT NOT NULL, -- 'Nov 13'
  
  -- Additional context
  qualifiers JSONB, -- {frequency: 'weekly', required: true}
  
  -- Provenance
  source_type TEXT,
  source_id UUID,
  chunk_id UUID,
  start_offset INT,
  end_offset INT,
  
  -- Metadata
  confidence FLOAT DEFAULT 1.0,
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS fact_space_id_idx ON fact(space_id);
CREATE INDEX IF NOT EXISTS fact_kind_idx ON fact(kind);
CREATE INDEX IF NOT EXISTS fact_subject_idx ON fact(subject);
CREATE INDEX IF NOT EXISTS fact_predicate_idx ON fact(predicate);

-- ============================================================================
-- LINKBACKS (Source Citations)
-- ============================================================================
-- Every fact/event/policy links back to its source for citations
CREATE TABLE IF NOT EXISTS linkback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- What entity this links to
  entity_type TEXT NOT NULL, -- 'event', 'policy', 'person', 'fact'
  entity_id UUID NOT NULL,
  
  -- Source reference
  source_type TEXT NOT NULL, -- 'resource', 'google_doc', 'slack_message'
  source_id UUID NOT NULL,
  chunk_id UUID,
  start_offset INT,
  end_offset INT,
  
  -- Display info
  source_title TEXT, -- for display: "Big-Little Guide"
  section_name TEXT, -- for display: "§Ceremony"
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS linkback_entity_idx ON linkback(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS linkback_source_idx ON linkback(source_type, source_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get event by name or alias
CREATE OR REPLACE FUNCTION find_event_by_name(
  search_name TEXT,
  target_space_id UUID
)
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  location TEXT,
  match_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH direct_matches AS (
    -- Direct name match
    SELECT 
      e.id,
      e.name,
      e.start_at,
      e.end_at,
      e.location,
      'direct'::TEXT as match_type
    FROM event e
    WHERE e.space_id = target_space_id
      AND e.name ILIKE '%' || search_name || '%'
  ),
  alias_matches AS (
    -- Alias match
    SELECT 
      e.id,
      e.name,
      e.start_at,
      e.end_at,
      e.location,
      'alias'::TEXT as match_type
    FROM event e
    JOIN event_alias ea ON ea.event_id = e.id
    WHERE e.space_id = target_space_id
      AND ea.alias ILIKE '%' || search_name || '%'
  )
  SELECT * FROM direct_matches
  UNION ALL
  SELECT * FROM alias_matches
  ORDER BY match_type, event_name
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- Function to get linkbacks for an entity
CREATE OR REPLACE FUNCTION get_linkbacks(
  entity_type_param TEXT,
  entity_id_param UUID
)
RETURNS TABLE (
  source_title TEXT,
  section_name TEXT,
  citation TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.source_title,
    l.section_name,
    CASE 
      WHEN l.section_name IS NOT NULL THEN l.source_title || ' §' || l.section_name
      ELSE l.source_title
    END as citation
  FROM linkback l
  WHERE l.entity_type = entity_type_param
    AND l.entity_id = entity_id_param
  ORDER BY l.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE event IS 'Structured event information extracted from documents, Slack, and calendar';
COMMENT ON TABLE event_alias IS 'Alternative names for events to enable flexible matching';
COMMENT ON TABLE policy IS 'Structured policy/program information extracted from documents';
COMMENT ON TABLE person IS 'People in the organization with roles and contact info';
COMMENT ON TABLE fact IS 'Atomic knowledge triples for flexible querying';
COMMENT ON TABLE linkback IS 'Source citations for all extracted knowledge';
