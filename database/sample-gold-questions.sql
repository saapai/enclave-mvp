-- Sample Gold Questions for UCLA SEP
-- Use these to evaluate system quality

-- Replace 'YOUR_SPACE_ID' with actual UCLA SEP workspace ID

-- ============================================================================
-- EVENT QUESTIONS (Easy)
-- ============================================================================

INSERT INTO gold_question (space_id, question, category, expected_answer, expected_sources, difficulty) VALUES
('YOUR_SPACE_ID', 'When is active meeting', 'event', 'Wednesday at 8:00 PM at Mahi''s apartment (461B Kelton) or Ash''s apartment (610 Levering)', ARRAY['SEP Fall Quarter', 'Active Meeting'], 'easy'),

('YOUR_SPACE_ID', 'When is study session', 'event', 'Wednesdays 6:30-12:30 at Rieber Terrace 9th Floor Lounge', ARRAY['SEP Fall Quarter', 'Study Hall'], 'easy'),

('YOUR_SPACE_ID', 'When is IM futsal', 'event', 'Sundays at 9 PM at Sunset Rec', ARRAY['IM futsal'], 'easy'),

('YOUR_SPACE_ID', 'When is big little appreciation', 'event', 'Wednesday, December 3rd. Littles express gratitude by creating gifts (often decorated paddles) and performing songs/skits', ARRAY['SEP Fall Quarter'], 'medium');

-- ============================================================================
-- POLICY QUESTIONS (Medium)
-- ============================================================================

INSERT INTO gold_question (space_id, question, category, expected_answer, expected_sources, difficulty) VALUES
('YOUR_SPACE_ID', 'What is the attendance policy', 'policy', 'Attendance is mandatory for active meetings. Missing meetings may result in penalties', ARRAY['SEP Fall Quarter'], 'medium'),

('YOUR_SPACE_ID', 'How does big little work', 'policy', 'Bigs mentor Littles (new members). Big Little Appreciation is when Littles show gratitude through gifts and performances', ARRAY['SEP Fall Quarter'], 'medium');

-- ============================================================================
-- LOCATION QUESTIONS (Easy)
-- ============================================================================

INSERT INTO gold_question (space_id, question, category, expected_answer, expected_sources, difficulty) VALUES
('YOUR_SPACE_ID', 'Where is active meeting', 'event', 'Mahi''s apartment (461B Kelton) or Ash''s apartment (610 Levering)', ARRAY['Active Meeting', 'SEP Fall Quarter'], 'easy'),

('YOUR_SPACE_ID', 'Where is study hall', 'event', 'Rieber Terrace 9th Floor Lounge', ARRAY['SEP Fall Quarter'], 'easy');

-- ============================================================================
-- TIME QUESTIONS (Easy)
-- ============================================================================

INSERT INTO gold_question (space_id, question, category, expected_answer, expected_sources, difficulty) VALUES
('YOUR_SPACE_ID', 'What time is active meeting', 'event', '8:00 PM', ARRAY['Active Meeting', 'SEP Fall Quarter'], 'easy'),

('YOUR_SPACE_ID', 'What time is study session', 'event', '6:30 PM to 12:30 AM', ARRAY['SEP Fall Quarter'], 'easy');

-- ============================================================================
-- COMPLEX QUESTIONS (Hard)
-- ============================================================================

INSERT INTO gold_question (space_id, question, category, expected_answer, expected_sources, difficulty) VALUES
('YOUR_SPACE_ID', 'What events are happening this week', 'event', 'Active Meeting (Wednesday 8 PM), Study Hall (Wednesday 6:30 PM), IM Futsal (Sunday 9 PM)', ARRAY['SEP Fall Quarter', 'Active Meeting', 'IM futsal'], 'hard'),

('YOUR_SPACE_ID', 'What do I need to know about big little', 'policy', 'Big Little is a mentorship program. Big Little Appreciation is December 3rd where Littles create gifts and perform for their Bigs', ARRAY['SEP Fall Quarter'], 'hard');

-- ============================================================================
-- USAGE
-- ============================================================================

-- To load these questions:
-- 1. Replace 'YOUR_SPACE_ID' with actual workspace ID
-- 2. Run: psql $DATABASE_URL -f database/sample-gold-questions.sql

-- To run evaluation:
-- curl -X POST https://www.tryenclave.com/api/eval \
--   -H "Content-Type: application/json" \
--   -d '{"spaceId": "YOUR_SPACE_ID", "usePlanner": true}'

-- To view results:
-- curl https://www.tryenclave.com/api/eval?runId=EVAL_RUN_ID

