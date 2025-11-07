import fs from 'fs'
import path from 'path'

export type EnclaveItem = {
  layer: 'enclave'
  id: string
  title?: string
  snippet: string
  features: Record<string, number | string | boolean>
  score: number
}

export async function retrieveEnclave(query: string): Promise<EnclaveItem[]> {
  try {
    const file = path.join(process.cwd(), 'docs', 'ENCLAVE_SYSTEM_REFERENCE.md')
    const content = fs.readFileSync(file, 'utf8')
    const lower = content.toLowerCase()
    const q = query.toLowerCase()
    const score = keywordScore(lower, q)
    if (score <= 0) return []
    return [{ layer: 'enclave', id: 'enclave_ref_v1', title: 'Enclave System Reference', snippet: content.slice(0, 1200), features: { authority: 1 }, score }]
  } catch {
    return []
  }
}

function keywordScore(text: string, q: string): number {
  const terms = q.split(/\W+/).filter(Boolean)
  if (terms.length === 0) return 0
  let hits = 0
  for (const t of terms) if (text.includes(t)) hits++
  return Math.min(1, hits / Math.max(3, terms.length))
}





