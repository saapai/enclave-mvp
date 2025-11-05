/**
 * Workspace utilities
 */

import { supabase } from '@/lib/supabase'

/**
 * Get all SEP workspace IDs
 */
export async function getWorkspaceIds(): Promise<string[]> {
  const { data: sepWorkspaces } = await supabase
    .from('space')
    .select('id, name')
    .ilike('name', '%SEP%')
  const unique = Array.from(new Set((sepWorkspaces || []).map(w => w.id)))
  // Return all SEP workspaces for cross-workspace search
  return unique
}

