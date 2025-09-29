-- Demo data for Enclave MVP
-- Run this after setting up the main schema

-- Insert some sample resources
INSERT INTO resource (id, space_id, type, title, body, url, source, visibility, created_by) VALUES
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'event', 'Semi-Formal 2024', 'Annual semi-formal dance event for all members. Dress code: semi-formal attire required.', 'https://example.com/semiformal', 'upload', 'space', '00000000-0000-0000-0000-000000000000'),
('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'form', 'Dues Payment Form', 'Pay your semester dues online. Payment is due by the 15th of each month.', 'https://example.com/dues', 'upload', 'space', '00000000-0000-0000-0000-000000000000'),
('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'doc', 'Chapter Bylaws', 'Official chapter bylaws and constitution. Updated as of Fall 2024.', 'https://example.com/bylaws.pdf', 'upload', 'space', '00000000-0000-0000-0000-000000000000'),
('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'event', 'Rush Week 2024', 'Annual recruitment week with various events and activities.', 'https://example.com/rush', 'upload', 'space', '00000000-0000-0000-0000-000000000000'),
('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'faq', 'Housing Information', 'Frequently asked questions about chapter housing, room assignments, and policies.', null, 'upload', 'space', '00000000-0000-0000-0000-000000000000');

-- Insert event metadata for events
INSERT INTO event_meta (resource_id, start_at, end_at, location, rsvp_link, cost, dress_code) VALUES
('11111111-1111-1111-1111-111111111111', '2024-12-15 19:00:00+00', '2024-12-15 23:00:00+00', 'Student Union Ballroom', 'https://example.com/rsvp-semiformal', '$25 per person', 'Semi-formal attire required'),
('44444444-4444-4444-4444-444444444444', '2024-09-15 10:00:00+00', '2024-09-22 18:00:00+00', 'Chapter House', 'https://example.com/rsvp-rush', 'Free', 'Casual attire');

-- Link resources to tags
INSERT INTO resource_tag (resource_id, tag_id) VALUES
-- Semi-Formal event
('11111111-1111-1111-1111-111111111111', (SELECT id FROM tag WHERE name = 'social' AND space_id = '00000000-0000-0000-0000-000000000000')),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM tag WHERE name = 'date' AND space_id = '00000000-0000-0000-0000-000000000000')),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM tag WHERE name = 'time' AND space_id = '00000000-0000-0000-0000-000000000000')),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM tag WHERE name = 'attire' AND space_id = '00000000-0000-0000-0000-000000000000')),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM tag WHERE name = 'rsvp' AND space_id = '00000000-0000-0000-0000-000000000000')),

-- Dues form
('22222222-2222-2222-2222-222222222222', (SELECT id FROM tag WHERE name = 'finance' AND space_id = '00000000-0000-0000-0000-000000000000')),
('22222222-2222-2222-2222-222222222222', (SELECT id FROM tag WHERE name = 'forms' AND space_id = '00000000-0000-0000-0000-000000000000')),

-- Bylaws
('33333333-3333-3333-3333-333333333333', (SELECT id FROM tag WHERE name = 'bylaws' AND space_id = '00000000-0000-0000-0000-000000000000')),
('33333333-3333-3333-3333-333333333333', (SELECT id FROM tag WHERE name = 'docs' AND space_id = '00000000-0000-0000-0000-000000000000')),

-- Rush Week
('44444444-4444-4444-4444-444444444444', (SELECT id FROM tag WHERE name = 'rush' AND space_id = '00000000-0000-0000-0000-000000000000')),
('44444444-4444-4444-4444-444444444444', (SELECT id FROM tag WHERE name = 'date' AND space_id = '00000000-0000-0000-0000-000000000000')),
('44444444-4444-4444-4444-444444444444', (SELECT id FROM tag WHERE name = 'pledges' AND space_id = '00000000-0000-0000-0000-000000000000')),

-- Housing FAQ
('55555555-5555-5555-5555-555555555555', (SELECT id FROM tag WHERE name = 'housing' AND space_id = '00000000-0000-0000-0000-000000000000')),
('55555555-5555-5555-5555-555555555555', (SELECT id FROM tag WHERE name = 'faq' AND space_id = '00000000-0000-0000-0000-000000000000'));

-- Insert some sample query logs
INSERT INTO query_log (space_id, user_id, text, results_count, clicked_resource_id) VALUES
('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'semi-formal bus time', 1, '11111111-1111-1111-1111-111111111111'),
('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'dues form', 1, '22222222-2222-2222-2222-222222222222'),
('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'rush events', 1, '44444444-4444-4444-4444-444444444444'),
('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'housing information', 1, '55555555-5555-5555-5555-555555555555');



