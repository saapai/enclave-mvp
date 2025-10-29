-- Announcements Schema
-- Store drafted and scheduled announcements for SMS broadcast

-- Announcements table
CREATE TABLE IF NOT EXISTS announcement (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Creator
  creator_phone TEXT NOT NULL,
  workspace_id UUID REFERENCES space(id) ON DELETE CASCADE,
  
  -- Content
  draft_content TEXT NOT NULL,
  final_content TEXT,
  tone TEXT, -- 'neutral', 'urgent', 'casual', 'mean', etc.
  
  -- Scheduling
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'sent', 'cancelled'
  
  -- Audience
  target_audience TEXT DEFAULT 'all', -- 'all', 'actives', 'pledges', etc.
  recipient_count INT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT announcement_status_check CHECK (status IN ('draft', 'scheduled', 'sent', 'cancelled'))
);

-- Announcement delivery log
CREATE TABLE IF NOT EXISTS announcement_delivery (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcement(id) ON DELETE CASCADE,
  
  -- Recipient
  recipient_phone TEXT NOT NULL,
  
  -- Delivery status
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'
  twilio_sid TEXT,
  error_message TEXT,
  
  -- Timestamps
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT announcement_delivery_status_check CHECK (status IN ('pending', 'sent', 'delivered', 'failed'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS announcement_creator_idx ON announcement(creator_phone);
CREATE INDEX IF NOT EXISTS announcement_workspace_idx ON announcement(workspace_id);
CREATE INDEX IF NOT EXISTS announcement_status_idx ON announcement(status);
CREATE INDEX IF NOT EXISTS announcement_scheduled_for_idx ON announcement(scheduled_for);
CREATE INDEX IF NOT EXISTS announcement_delivery_announcement_idx ON announcement_delivery(announcement_id);
CREATE INDEX IF NOT EXISTS announcement_delivery_recipient_idx ON announcement_delivery(recipient_phone);

-- Function to get pending scheduled announcements
CREATE OR REPLACE FUNCTION get_pending_announcements()
RETURNS TABLE (
  announcement_id UUID,
  content TEXT,
  creator TEXT,
  workspace_id UUID,
  scheduled_for TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    id,
    final_content,
    creator_phone,
    announcement.workspace_id,
    announcement.scheduled_for
  FROM announcement
  WHERE status = 'scheduled'
    AND scheduled_for <= NOW()
  ORDER BY scheduled_for ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to mark announcement as sent
CREATE OR REPLACE FUNCTION mark_announcement_sent(
  p_announcement_id UUID,
  p_recipient_count INT
)
RETURNS void AS $$
BEGIN
  UPDATE announcement
  SET 
    status = 'sent',
    sent_at = NOW(),
    recipient_count = p_recipient_count,
    updated_at = NOW()
  WHERE id = p_announcement_id;
END;
$$ LANGUAGE plpgsql;

