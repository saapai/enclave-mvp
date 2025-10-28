-- Proactive Alerts Schema
-- Deadline detection and reminder system

-- ============================================================================
-- ALERTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  
  -- Alert type
  kind TEXT NOT NULL CHECK (kind IN ('deadline', 'event_reminder', 'custom')),
  
  -- Timing
  fire_at TIMESTAMPTZ NOT NULL,
  fired_at TIMESTAMPTZ,
  
  -- Content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  
  -- Recipients
  recipients TEXT[] NOT NULL, -- array of phone numbers or user IDs
  
  -- Source reference
  source_type TEXT, -- 'resource', 'event', 'policy'
  source_id UUID,
  
  -- Metadata
  metadata JSONB, -- {original_text, extracted_date, confidence}
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'fired', 'cancelled', 'failed')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS alert_space_id_idx ON alert(space_id);
CREATE INDEX IF NOT EXISTS alert_fire_at_idx ON alert(fire_at);
CREATE INDEX IF NOT EXISTS alert_status_idx ON alert(status);
CREATE INDEX IF NOT EXISTS alert_kind_idx ON alert(kind);

-- ============================================================================
-- ALERT LOG TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES alert(id) ON DELETE CASCADE,
  
  -- Delivery info
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'failed')),
  error_message TEXT,
  
  -- Twilio info
  twilio_sid TEXT,
  
  -- Timestamps
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS alert_log_alert_id_idx ON alert_log(alert_id);
CREATE INDEX IF NOT EXISTS alert_log_status_idx ON alert_log(status);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get pending alerts that should fire now
CREATE OR REPLACE FUNCTION get_pending_alerts()
RETURNS TABLE (
  alert_id UUID,
  space_id UUID,
  kind TEXT,
  title TEXT,
  message TEXT,
  recipients TEXT[],
  fire_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.space_id,
    a.kind,
    a.title,
    a.message,
    a.recipients,
    a.fire_at
  FROM alert a
  WHERE a.status = 'pending'
    AND a.fire_at <= NOW()
  ORDER BY a.fire_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Mark alert as fired
CREATE OR REPLACE FUNCTION mark_alert_fired(alert_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE alert
  SET status = 'fired',
      fired_at = NOW(),
      updated_at = NOW()
  WHERE id = alert_id_param;
END;
$$ LANGUAGE plpgsql;

-- Cancel alert
CREATE OR REPLACE FUNCTION cancel_alert(alert_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE alert
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE id = alert_id_param;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE alert IS 'Proactive alerts for deadlines and event reminders';
COMMENT ON TABLE alert_log IS 'Delivery log for sent alerts';
COMMENT ON COLUMN alert.kind IS 'Type of alert: deadline, event_reminder, or custom';
COMMENT ON COLUMN alert.fire_at IS 'When to send the alert';
COMMENT ON COLUMN alert.recipients IS 'Array of phone numbers or user IDs to notify';

