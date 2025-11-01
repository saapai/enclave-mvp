-- Telemetry and Evaluation Schema
-- Track query performance and quality metrics

-- ============================================================================
-- QUERY TELEMETRY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS query_telemetry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Query info
  query TEXT NOT NULL,
  space_id UUID REFERENCES space(id) ON DELETE CASCADE,
  user_id TEXT,
  
  -- Plan info (if using planner)
  intent TEXT, -- 'event_lookup', 'policy_lookup', 'doc_search', etc.
  plan_confidence FLOAT,
  tools_used TEXT[], -- array of tool names
  
  -- Results
  result_count INT,
  top_result_id UUID,
  top_result_score FLOAT,
  
  -- Performance
  retrieval_time_ms INT,
  total_time_ms INT,
  
  -- Source breakdown
  sources_used JSONB, -- {fts: 2, vector: 3, gdocs: 1, calendar: 0}
  
  -- Response quality
  response_confidence FLOAT,
  response_length INT,
  
  -- User feedback (if provided)
  user_satisfaction TEXT CHECK (user_satisfaction IN ('thumbs_up', 'thumbs_down', NULL)),
  user_feedback TEXT,
  
  -- Metadata
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS query_telemetry_space_id_idx ON query_telemetry(space_id);
CREATE INDEX IF NOT EXISTS query_telemetry_intent_idx ON query_telemetry(intent);
CREATE INDEX IF NOT EXISTS query_telemetry_created_at_idx ON query_telemetry(created_at);
CREATE INDEX IF NOT EXISTS query_telemetry_user_satisfaction_idx ON query_telemetry(user_satisfaction);

-- ============================================================================
-- GOLD QUESTIONS TABLE (Eval Dataset)
-- ============================================================================
CREATE TABLE IF NOT EXISTS gold_question (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID REFERENCES space(id) ON DELETE CASCADE,
  
  -- Question
  question TEXT NOT NULL,
  category TEXT, -- 'event', 'policy', 'person', 'general'
  
  -- Expected answer
  expected_answer TEXT NOT NULL,
  expected_sources TEXT[], -- array of expected source titles/IDs
  
  -- Metadata
  difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
  tags TEXT[],
  
  -- Status
  active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS gold_question_space_id_idx ON gold_question(space_id);
CREATE INDEX IF NOT EXISTS gold_question_category_idx ON gold_question(category);
CREATE INDEX IF NOT EXISTS gold_question_active_idx ON gold_question(active);

-- ============================================================================
-- EVAL RUN TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS eval_run (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Run info
  name TEXT,
  space_id UUID REFERENCES space(id) ON DELETE CASCADE,
  
  -- Config
  config JSONB, -- {use_planner: true, use_reranking: true, ...}
  
  -- Results
  total_questions INT,
  correct_answers INT,
  partial_answers INT,
  incorrect_answers INT,
  no_answers INT,
  
  -- Metrics
  precision_at_1 FLOAT,
  recall FLOAT,
  f1_score FLOAT,
  avg_confidence FLOAT,
  avg_retrieval_time_ms INT,
  
  -- Status
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  
  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS eval_run_space_id_idx ON eval_run(space_id);
CREATE INDEX IF NOT EXISTS eval_run_status_idx ON eval_run(status);
CREATE INDEX IF NOT EXISTS eval_run_started_at_idx ON eval_run(started_at);

-- ============================================================================
-- EVAL RESULT TABLE (Individual question results)
-- ============================================================================
CREATE TABLE IF NOT EXISTS eval_result (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eval_run_id UUID NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
  gold_question_id UUID NOT NULL REFERENCES gold_question(id) ON DELETE CASCADE,
  
  -- Result
  actual_answer TEXT,
  actual_sources TEXT[],
  
  -- Scoring
  score TEXT CHECK (score IN ('correct', 'partial', 'incorrect', 'no_answer')),
  confidence FLOAT,
  
  -- Performance
  retrieval_time_ms INT,
  
  -- Metadata
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS eval_result_eval_run_id_idx ON eval_result(eval_run_id);
CREATE INDEX IF NOT EXISTS eval_result_score_idx ON eval_result(score);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get telemetry summary for a time period
CREATE OR REPLACE FUNCTION get_telemetry_summary(
  space_id_param UUID,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
RETURNS TABLE (
  total_queries INT,
  avg_retrieval_time_ms FLOAT,
  avg_confidence FLOAT,
  thumbs_up_count INT,
  thumbs_down_count INT,
  top_intents JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INT as total_queries,
    AVG(retrieval_time_ms)::FLOAT as avg_retrieval_time_ms,
    AVG(response_confidence)::FLOAT as avg_confidence,
    COUNT(*) FILTER (WHERE user_satisfaction = 'thumbs_up')::INT as thumbs_up_count,
    COUNT(*) FILTER (WHERE user_satisfaction = 'thumbs_down')::INT as thumbs_down_count,
    jsonb_object_agg(intent, intent_count) as top_intents
  FROM (
    SELECT 
      intent,
      COUNT(*) as intent_count
    FROM query_telemetry
    WHERE space_id = space_id_param
      AND created_at BETWEEN start_date AND end_date
      AND intent IS NOT NULL
    GROUP BY intent
  ) intent_counts;
END;
$$ LANGUAGE plpgsql;

-- Get eval run summary
CREATE OR REPLACE FUNCTION get_eval_summary(eval_run_id_param UUID)
RETURNS TABLE (
  run_name TEXT,
  total_questions INT,
  correct INT,
  partial INT,
  incorrect INT,
  no_answer INT,
  accuracy FLOAT,
  avg_confidence FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    er.name,
    er.total_questions,
    er.correct_answers,
    er.partial_answers,
    er.incorrect_answers,
    er.no_answers,
    (er.correct_answers::FLOAT / NULLIF(er.total_questions, 0)) as accuracy,
    er.avg_confidence
  FROM eval_run er
  WHERE er.id = eval_run_id_param;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE query_telemetry IS 'Tracks all queries for performance and quality analysis';
COMMENT ON TABLE gold_question IS 'Gold standard questions for evaluation';
COMMENT ON TABLE eval_run IS 'Evaluation runs with aggregate metrics';
COMMENT ON TABLE eval_result IS 'Individual question results from eval runs';

