-- Add requires_reason column to sms_poll table
-- This allows polls to enforce that "No" responses must include a reason

ALTER TABLE sms_poll
ADD COLUMN IF NOT EXISTS requires_reason BOOLEAN DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN sms_poll.requires_reason IS 'If true, "No" responses must include a reason/note';

