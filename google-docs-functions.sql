-- Function to update Google Doc source and chunks atomically
CREATE OR REPLACE FUNCTION update_google_doc_source_and_chunks(
  source_id UUID,
  new_revision_id TEXT,
  new_modified_time TEXT,
  new_permissions_hash TEXT,
  new_chunks JSONB[]
)
RETURNS VOID AS $$
DECLARE
  source_record RECORD;
  chunk_record JSONB;
  embedding_vector VECTOR(1024);
BEGIN
  -- Get source record
  SELECT * INTO source_record FROM sources_google_docs WHERE id = source_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source not found: %', source_id;
  END IF;

  -- Update source metadata
  UPDATE sources_google_docs 
  SET 
    latest_revision_id = new_revision_id,
    modified_time = new_modified_time::TIMESTAMPTZ,
    permissions_hash = new_permissions_hash,
    updated_at = NOW()
  WHERE id = source_id;

  -- Delete existing chunks
  DELETE FROM google_doc_chunks WHERE source_id = source_id;

  -- Insert new chunks (without embeddings for now - will be generated async)
  FOR chunk_record IN SELECT * FROM jsonb_array_elements(new_chunks::jsonb)
  LOOP
    INSERT INTO google_doc_chunks (
      space_id,
      source_id,
      heading_path,
      text,
      metadata,
      chunk_index,
      embedding
    ) VALUES (
      (chunk_record->>'space_id')::UUID,
      source_id,
      ARRAY(SELECT jsonb_array_elements_text(chunk_record->'heading_path')),
      chunk_record->>'text',
      chunk_record->'metadata',
      (chunk_record->>'chunk_index')::INTEGER,
      NULL -- Embeddings will be generated separately
    );
  END LOOP;

END;
$$ LANGUAGE plpgsql;
