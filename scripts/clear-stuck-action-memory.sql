-- Clear stuck action memory for phone number 3853687238
-- Run this in Supabase SQL editor

DELETE FROM sms_action_memory
WHERE phone = '3853687238'
  AND action_type = 'query'
  AND created_at < NOW() - INTERVAL '5 minutes';

-- Show what's left
SELECT * FROM sms_action_memory
WHERE phone = '3853687238'
ORDER BY created_at DESC
LIMIT 10;


