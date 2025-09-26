-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create tables
CREATE TABLE space (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  domain TEXT,
  default_visibility TEXT DEFAULT 'space',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE app_user (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID REFERENCES space(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  role TEXT CHECK (role IN ('member', 'curator', 'admin')) DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE resource (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID REFERENCES space(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('event', 'doc', 'form', 'link', 'faq')) NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  source TEXT CHECK (source IN ('upload', 'gdoc', 'gcal', 'slack', 'sms')) DEFAULT 'upload',
  visibility TEXT DEFAULT 'space',
  created_by UUID REFERENCES app_user(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tag (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID REFERENCES space(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id, name)
);

CREATE TABLE resource_tag (
  resource_id UUID REFERENCES resource(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tag(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (resource_id, tag_id)
);

CREATE TABLE event_meta (
  resource_id UUID PRIMARY KEY REFERENCES resource(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  location TEXT,
  rsvp_link TEXT,
  cost TEXT,
  dress_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE query_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID REFERENCES space(id) ON DELETE CASCADE,
  user_id UUID REFERENCES app_user(id),
  text TEXT,
  ts TIMESTAMPTZ DEFAULT NOW(),
  results_count INTEGER,
  clicked_resource_id UUID REFERENCES resource(id),
  satisfaction TEXT CHECK (satisfaction IN ('thumbs_up', 'thumbs_down')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gap_alert (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID REFERENCES space(id) ON DELETE CASCADE,
  query_text TEXT,
  count_last_24h INTEGER,
  status TEXT CHECK (status IN ('open', 'claimed', 'resolved')) DEFAULT 'open',
  assigned_to UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for full-text search
CREATE INDEX res_ft ON resource USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')));
CREATE INDEX tag_name_idx ON tag (name);
CREATE INDEX resource_space_idx ON resource (space_id);
CREATE INDEX resource_type_idx ON resource (type);
CREATE INDEX resource_created_by_idx ON resource (created_by);
CREATE INDEX resource_updated_at_idx ON resource (updated_at);
CREATE INDEX query_log_space_idx ON query_log (space_id);
CREATE INDEX query_log_ts_idx ON query_log (ts);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_space_updated_at BEFORE UPDATE ON space FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_app_user_updated_at BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_resource_updated_at BEFORE UPDATE ON resource FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tag_updated_at BEFORE UPDATE ON tag FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_event_meta_updated_at BEFORE UPDATE ON event_meta FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gap_alert_updated_at BEFORE UPDATE ON gap_alert FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default space
INSERT INTO space (id, name, domain, default_visibility) 
VALUES ('00000000-0000-0000-0000-000000000000', 'Default Chapter', 'enclave.local', 'space');

-- Insert default tags
INSERT INTO tag (space_id, name, kind) VALUES
('00000000-0000-0000-0000-000000000000', 'rush', 'topic'),
('00000000-0000-0000-0000-000000000000', 'philanthropy', 'topic'),
('00000000-0000-0000-0000-000000000000', 'social', 'topic'),
('00000000-0000-0000-0000-000000000000', 'academics', 'topic'),
('00000000-0000-0000-0000-000000000000', 'athletics', 'topic'),
('00000000-0000-0000-0000-000000000000', 'housing', 'topic'),
('00000000-0000-0000-0000-000000000000', 'alumni', 'topic'),
('00000000-0000-0000-0000-000000000000', 'risk', 'topic'),
('00000000-0000-0000-0000-000000000000', 'finance', 'topic'),
('00000000-0000-0000-0000-000000000000', 'tech', 'topic'),
('00000000-0000-0000-0000-000000000000', 'date', 'logistics'),
('00000000-0000-0000-0000-000000000000', 'time', 'logistics'),
('00000000-0000-0000-0000-000000000000', 'location', 'logistics'),
('00000000-0000-0000-0000-000000000000', 'cost', 'logistics'),
('00000000-0000-0000-0000-000000000000', 'ride', 'logistics'),
('00000000-0000-0000-0000-000000000000', 'attire', 'logistics'),
('00000000-0000-0000-0000-000000000000', 'rsvp', 'logistics'),
('00000000-0000-0000-0000-000000000000', 'pledges', 'audience'),
('00000000-0000-0000-0000-000000000000', 'actives', 'audience'),
('00000000-0000-0000-0000-000000000000', 'officers', 'audience'),
('00000000-0000-0000-0000-000000000000', 'bylaws', 'docs'),
('00000000-0000-0000-0000-000000000000', 'handbook', 'docs'),
('00000000-0000-0000-0000-000000000000', 'forms', 'docs'),
('00000000-0000-0000-0000-000000000000', 'waivers', 'docs');

