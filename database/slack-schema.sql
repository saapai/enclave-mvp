-- Slack Integration Schema for Enclave MVP
-- This enables Slack workspaces as external data sources

-- Table to store Slack workspace connections (OAuth tokens)
CREATE TABLE IF NOT EXISTS slack_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- Clerk user ID
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Slack OAuth tokens
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  
  -- Slack workspace info
  team_id TEXT NOT NULL, -- Slack workspace/team ID
  team_name TEXT NOT NULL,
  bot_user_id TEXT, -- Bot user ID for posting
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, team_id)
);

-- Table to store Slack channels
CREATE TABLE IF NOT EXISTS slack_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_account_id UUID NOT NULL REFERENCES slack_accounts(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Slack channel info
  slack_channel_id TEXT NOT NULL, -- Slack's channel ID (e.g., C1234567890)
  channel_name TEXT NOT NULL, -- e.g., "general", "random"
  channel_type TEXT NOT NULL, -- "public_channel", "private_channel", "im", "mpim"
  is_archived BOOLEAN DEFAULT FALSE,
  is_member BOOLEAN DEFAULT TRUE,
  
  -- Indexing metadata
  last_indexed_at TIMESTAMPTZ,
  last_message_ts TEXT, -- Timestamp of last indexed message
  message_count INTEGER DEFAULT 0,
  
  -- Settings
  auto_sync BOOLEAN DEFAULT TRUE, -- Whether to auto-sync new messages
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(slack_account_id, slack_channel_id)
);

-- Table to store Slack messages
CREATE TABLE IF NOT EXISTS slack_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_channel_id UUID NOT NULL REFERENCES slack_channels(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Slack message info
  slack_message_id TEXT NOT NULL, -- Slack's message timestamp (acts as ID)
  thread_ts TEXT, -- Thread parent timestamp (null if not in thread)
  
  -- Message content
  user_id TEXT, -- Slack user ID
  username TEXT, -- Display name
  text TEXT NOT NULL, -- Message text
  
  -- Threading and context
  is_thread_parent BOOLEAN DEFAULT FALSE,
  reply_count INTEGER DEFAULT 0,
  thread_context TEXT, -- AI-generated thread summary if in thread
  
  -- Attachments and files
  has_files BOOLEAN DEFAULT FALSE,
  file_urls TEXT[], -- URLs to any attached files
  
  -- Timestamps
  posted_at TIMESTAMPTZ NOT NULL, -- When message was posted in Slack
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(slack_channel_id, slack_message_id)
);

-- Table to store message chunks with embeddings (for vector search)
CREATE TABLE IF NOT EXISTS slack_message_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_message_id UUID NOT NULL REFERENCES slack_messages(id) ON DELETE CASCADE,
  slack_channel_id UUID NOT NULL REFERENCES slack_channels(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Chunk content
  text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL, -- Order within message (usually 0 for single message)
  
  -- Context
  thread_context TEXT, -- Summary of thread if message is in thread
  channel_context TEXT, -- Channel name and description
  
  -- Vector embedding for semantic search
  embedding vector(1024), -- Mistral embeddings are 1024 dimensions
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_slack_accounts_user_id ON slack_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_slack_accounts_space_id ON slack_accounts(space_id);
CREATE INDEX IF NOT EXISTS idx_slack_accounts_team_id ON slack_accounts(team_id);

CREATE INDEX IF NOT EXISTS idx_slack_channels_account_id ON slack_channels(slack_account_id);
CREATE INDEX IF NOT EXISTS idx_slack_channels_space_id ON slack_channels(space_id);
CREATE INDEX IF NOT EXISTS idx_slack_channels_slack_id ON slack_channels(slack_channel_id);
CREATE INDEX IF NOT EXISTS idx_slack_channels_auto_sync ON slack_channels(auto_sync) WHERE auto_sync = TRUE;

CREATE INDEX IF NOT EXISTS idx_slack_messages_channel_id ON slack_messages(slack_channel_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_space_id ON slack_messages(space_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_thread_ts ON slack_messages(thread_ts) WHERE thread_ts IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slack_messages_posted_at ON slack_messages(posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_slack_chunks_message_id ON slack_message_chunks(slack_message_id);
CREATE INDEX IF NOT EXISTS idx_slack_chunks_channel_id ON slack_message_chunks(slack_channel_id);
CREATE INDEX IF NOT EXISTS idx_slack_chunks_space_id ON slack_message_chunks(space_id);

-- Create vector search index (requires pgvector extension)
CREATE INDEX IF NOT EXISTS idx_slack_chunks_embedding ON slack_message_chunks 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Function to search Slack messages by vector similarity
CREATE OR REPLACE FUNCTION search_slack_messages_vector(
  query_embedding vector(1024),
  target_space_id UUID,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  slack_message_id UUID,
  slack_channel_id UUID,
  text TEXT,
  thread_context TEXT,
  channel_context TEXT,
  similarity DOUBLE PRECISION,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    smc.id,
    smc.slack_message_id,
    smc.slack_channel_id,
    smc.text,
    smc.thread_context,
    smc.channel_context,
    1 - (smc.embedding <=> query_embedding) as similarity,
    smc.created_at
  FROM slack_message_chunks smc
  WHERE smc.space_id = target_space_id
    AND smc.embedding IS NOT NULL
  ORDER BY smc.embedding <=> query_embedding
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get thread context (all messages in a thread)
CREATE OR REPLACE FUNCTION get_slack_thread_messages(
  target_thread_ts TEXT,
  target_channel_id UUID
)
RETURNS TABLE (
  id UUID,
  slack_message_id TEXT,
  text TEXT,
  username TEXT,
  posted_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sm.id,
    sm.slack_message_id,
    sm.text,
    sm.username,
    sm.posted_at
  FROM slack_messages sm
  WHERE sm.slack_channel_id = target_channel_id
    AND (sm.thread_ts = target_thread_ts OR sm.slack_message_id = target_thread_ts)
  ORDER BY sm.posted_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_slack_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER slack_accounts_updated_at
  BEFORE UPDATE ON slack_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_slack_updated_at();

CREATE TRIGGER slack_channels_updated_at
  BEFORE UPDATE ON slack_channels
  FOR EACH ROW
  EXECUTE FUNCTION update_slack_updated_at();

CREATE TRIGGER slack_messages_updated_at
  BEFORE UPDATE ON slack_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_slack_updated_at();

-- Grant permissions (adjust as needed for your RLS policies)
-- For now, disabling RLS for simplicity (similar to Google Docs setup)
ALTER TABLE slack_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE slack_channels DISABLE ROW LEVEL SECURITY;
ALTER TABLE slack_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE slack_message_chunks DISABLE ROW LEVEL SECURITY;

