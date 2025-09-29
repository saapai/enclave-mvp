-- Fix foreign key constraint to allow resource deletion
ALTER TABLE query_log DROP CONSTRAINT IF EXISTS query_log_clicked_resource_id_fkey;
ALTER TABLE query_log ADD CONSTRAINT query_log_clicked_resource_id_fkey 
  FOREIGN KEY (clicked_resource_id) REFERENCES resource(id) ON DELETE CASCADE;
