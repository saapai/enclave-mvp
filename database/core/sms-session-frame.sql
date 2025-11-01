-- Session Frame Schema
-- Add JSONB frame to sms_query_session for context-aware responses

-- Add frame column to session table
ALTER TABLE sms_query_session 
ADD COLUMN IF NOT EXISTS frame JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NOW() + interval '15 minutes';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS sms_query_session_expires_idx ON sms_query_session (expires_at);

-- Create function to get or create session with rolling TTL
CREATE OR REPLACE FUNCTION get_or_create_sms_session(
  p_phone_number TEXT,
  p_workspace_id UUID
)
RETURNS TABLE (
  id UUID,
  phone_number TEXT,
  frame JSONB,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  v_session_id UUID;
BEGIN
  -- Get existing active session
  SELECT s.id INTO v_session_id
  FROM sms_query_session s
  WHERE s.phone_number = p_phone_number
    AND s.workspace_id = p_workspace_id
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  ORDER BY s.created_at DESC
  LIMIT 1;
  
  IF v_session_id IS NOT NULL THEN
    -- Update TTL
    UPDATE sms_query_session
    SET 
      expires_at = NOW() + interval '15 minutes',
      updated_at = NOW()
    WHERE id = v_session_id;
    
    -- Return updated session
    RETURN QUERY
    SELECT s.id, s.phone_number, s.frame, s.expires_at
    FROM sms_query_session s
    WHERE s.id = v_session_id;
  ELSE
    -- Create new session
    INSERT INTO sms_query_session (phone_number, workspace_id, frame, expires_at)
    VALUES (p_phone_number, p_workspace_id, '{}'::jsonb, NOW() + interval '15 minutes')
    RETURNING sms_query_session.id, sms_query_session.phone_number, 
              sms_query_session.frame, sms_query_session.expires_at
    INTO v_session_id, phone_number, frame, expires_at;
    
    -- Return new session
    RETURN QUERY
    SELECT v_session_id, p_phone_number, '{}'::jsonb, NOW() + interval '15 minutes';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to update frame
CREATE OR REPLACE FUNCTION update_sms_frame(
  p_session_id UUID,
  p_frame_updates JSONB
)
RETURNS void AS $$
BEGIN
  UPDATE sms_query_session
  SET 
    frame = frame || p_frame_updates,
    updated_at = NOW()
  WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql;

-- Cleanup expired sessions (call periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_sms_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM sms_query_session
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

