-- Fix Google Docs visibility to be user-scoped
-- Google Docs should only be visible to the user who added them

-- Drop existing policies
DROP POLICY IF EXISTS "Users can access google docs in their spaces" ON sources_google_docs;
DROP POLICY IF EXISTS "Users can access google doc chunks in their spaces" ON google_doc_chunks;

-- Google Docs sources: users can only see docs they added
CREATE POLICY "Users can access their own google docs" ON sources_google_docs
  FOR ALL USING (
    added_by = auth.uid()::text
  );

-- Google doc chunks: users can only see chunks from docs they added
CREATE POLICY "Users can access their own google doc chunks" ON google_doc_chunks
  FOR ALL USING (
    source_id IN (
      SELECT id FROM sources_google_docs WHERE added_by = auth.uid()::text
    )
  );

-- Service role can access everything
DROP POLICY IF EXISTS "Service role can manage google docs" ON sources_google_docs;
DROP POLICY IF EXISTS "Service role can manage google doc chunks" ON google_doc_chunks;

CREATE POLICY "Service role can manage google docs" ON sources_google_docs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage google doc chunks" ON google_doc_chunks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


