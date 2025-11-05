/**
 * Workspace utilities
 */

import { supabase } from '@/lib/supabase'

/**
 * Get SEP workspace IDs
 */
export async function getWorkspaceIds(): Promise<string[]> {
  const { data: sepWorkspaces } = await supabase
    .from('space')
    .select('id, name')
    .ilike('name', '%SEP%')
  const unique = Array.from(new Set((sepWorkspaces || []).map(w => w.id)))
  // Keep just one workspace to avoid redundant searches
  return unique.slice(0, 1)
}

