/**
 * Hierarchical Chunker
 * Break documents into section → passage → sentence levels
 */

import { supabaseAdmin } from './supabase'
import { embedText } from './embeddings'

// ============================================================================
// TYPES
// ============================================================================

export interface HierarchicalChunk {
  id?: string
  resource_id: string
  space_id: string
  level: 'section' | 'passage' | 'sentence'
  parent_id?: string
  chunk_index: number
  start_offset: number
  end_offset: number
  text: string
  heading?: string
  heading_path?: string[]
  embedding?: number[]
  token_count?: number
}

// ============================================================================
// CHUNKING LOGIC
// ============================================================================

/**
 * Split text into hierarchical chunks
 */
export async function createHierarchicalChunks(
  text: string,
  resourceId: string,
  spaceId: string
): Promise<HierarchicalChunk[]> {
  console.log(`[Hierarchical Chunker] Processing ${text.length} chars for resource ${resourceId}`)

  const chunks: HierarchicalChunk[] = []

  // Level 1: Sections (split by headings or large paragraphs)
  const sections = splitIntoSections(text)
  console.log(`[Hierarchical Chunker] Created ${sections.length} sections`)

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]

    // Create section chunk
    const sectionChunk: HierarchicalChunk = {
      resource_id: resourceId,
      space_id: spaceId,
      level: 'section',
      chunk_index: i,
      start_offset: section.start,
      end_offset: section.end,
      text: section.text,
      heading: section.heading,
      heading_path: section.heading ? [section.heading] : [],
      token_count: estimateTokens(section.text)
    }

    chunks.push(sectionChunk)

    // Level 2: Passages (split section into ~500 char chunks)
    const passages = splitIntoPassages(section.text, section.start)

    for (let j = 0; j < passages.length; j++) {
      const passage = passages[j]

      const passageChunk: HierarchicalChunk = {
        resource_id: resourceId,
        space_id: spaceId,
        level: 'passage',
        chunk_index: j,
        start_offset: passage.start,
        end_offset: passage.end,
        text: passage.text,
        heading_path: section.heading ? [section.heading] : [],
        token_count: estimateTokens(passage.text)
      }

      chunks.push(passageChunk)

      // Level 3: Sentences (split passage into sentences)
      const sentences = splitIntoSentences(passage.text, passage.start)

      for (let k = 0; k < sentences.length; k++) {
        const sentence = sentences[k]

        const sentenceChunk: HierarchicalChunk = {
          resource_id: resourceId,
          space_id: spaceId,
          level: 'sentence',
          chunk_index: k,
          start_offset: sentence.start,
          end_offset: sentence.end,
          text: sentence.text,
          heading_path: section.heading ? [section.heading] : [],
          token_count: estimateTokens(sentence.text)
        }

        chunks.push(sentenceChunk)
      }
    }
  }

  console.log(`[Hierarchical Chunker] Created ${chunks.length} total chunks`)
  console.log(`[Hierarchical Chunker] Breakdown: ${sections.length} sections, ${chunks.filter(c => c.level === 'passage').length} passages, ${chunks.filter(c => c.level === 'sentence').length} sentences`)

  return chunks
}

/**
 * Split text into sections
 */
function splitIntoSections(text: string): Array<{ text: string; heading?: string; start: number; end: number }> {
  const sections: Array<{ text: string; heading?: string; start: number; end: number }> = []

  // Try to split by markdown headings
  const headingPattern = /^(#{1,3})\s+(.+)$/gm
  const matches = Array.from(text.matchAll(headingPattern))

  if (matches.length > 0) {
    // Split by headings
    let lastEnd = 0

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const nextMatch = matches[i + 1]

      const start = match.index!
      const end = nextMatch ? nextMatch.index! : text.length
      const sectionText = text.substring(start, end).trim()
      const heading = match[2].trim()

      if (sectionText.length > 0) {
        sections.push({
          text: sectionText,
          heading,
          start,
          end
        })
      }

      lastEnd = end
    }
  } else {
    // No headings, split by double newlines (paragraphs)
    const paragraphs = text.split(/\n\n+/)
    let offset = 0

    for (const para of paragraphs) {
      if (para.trim().length > 100) {
        sections.push({
          text: para.trim(),
          start: offset,
          end: offset + para.length
        })
      }
      offset += para.length + 2 // +2 for \n\n
    }
  }

  // If no sections found, treat entire text as one section
  if (sections.length === 0) {
    sections.push({
      text: text.trim(),
      start: 0,
      end: text.length
    })
  }

  return sections
}

/**
 * Split text into passages (~500 chars)
 */
function splitIntoPassages(text: string, baseOffset: number): Array<{ text: string; start: number; end: number }> {
  const passages: Array<{ text: string; start: number; end: number }> = []
  const targetSize = 500
  const overlap = 100

  let offset = 0

  while (offset < text.length) {
    const end = Math.min(offset + targetSize, text.length)
    let passageText = text.substring(offset, end)

    // Try to end at sentence boundary
    if (end < text.length) {
      const lastPeriod = passageText.lastIndexOf('. ')
      if (lastPeriod > targetSize * 0.5) {
        passageText = passageText.substring(0, lastPeriod + 1)
      }
    }

    passages.push({
      text: passageText.trim(),
      start: baseOffset + offset,
      end: baseOffset + offset + passageText.length
    })

    offset += passageText.length - overlap
    if (offset >= text.length) break
  }

  return passages
}

/**
 * Split text into sentences
 */
function splitIntoSentences(text: string, baseOffset: number): Array<{ text: string; start: number; end: number }> {
  const sentences: Array<{ text: string; start: number; end: number }> = []

  // Simple sentence splitting (can be improved with NLP library)
  const sentencePattern = /[^.!?]+[.!?]+/g
  const matches = Array.from(text.matchAll(sentencePattern))

  let offset = 0

  for (const match of matches) {
    const sentence = match[0].trim()
    
    if (sentence.length > 10) {
      sentences.push({
        text: sentence,
        start: baseOffset + offset,
        end: baseOffset + offset + sentence.length
      })
    }

    offset += match[0].length
  }

  // Handle remaining text
  if (offset < text.length) {
    const remaining = text.substring(offset).trim()
    if (remaining.length > 10) {
      sentences.push({
        text: remaining,
        start: baseOffset + offset,
        end: baseOffset + text.length
      })
    }
  }

  return sentences
}

/**
 * Estimate token count
 */
function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4)
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Save hierarchical chunks to database
 */
export async function saveHierarchicalChunks(
  chunks: HierarchicalChunk[]
): Promise<{ saved: number; failed: number }> {
  console.log(`[Hierarchical Chunker] Saving ${chunks.length} chunks to database`)

  let saved = 0
  let failed = 0

  // First, save all chunks without embeddings to get IDs
  const { data: insertedChunks, error: insertError } = await supabaseAdmin
    .from('hierarchical_chunk')
    .insert(chunks.map(c => ({
      resource_id: c.resource_id,
      space_id: c.space_id,
      level: c.level,
      parent_id: c.parent_id,
      chunk_index: c.chunk_index,
      start_offset: c.start_offset,
      end_offset: c.end_offset,
      text: c.text,
      heading: c.heading,
      heading_path: c.heading_path,
      token_count: c.token_count
    })))
    .select('id, level, text')

  if (insertError || !insertedChunks) {
    console.error('[Hierarchical Chunker] Error inserting chunks:', insertError)
    return { saved: 0, failed: chunks.length }
  }

  console.log(`[Hierarchical Chunker] Inserted ${insertedChunks.length} chunks, generating embeddings...`)

  // Generate embeddings for section and passage level (skip sentences for performance)
  for (const chunk of insertedChunks) {
    if (chunk.level === 'sentence') {
      saved++
      continue
    }

    try {
      const embedding = await embedText(chunk.text)

      await supabaseAdmin
        .from('hierarchical_chunk')
        .update({ embedding })
        .eq('id', chunk.id)

      saved++
    } catch (error) {
      console.error(`[Hierarchical Chunker] Error embedding chunk ${chunk.id}:`, error)
      failed++
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`[Hierarchical Chunker] Saved ${saved}/${chunks.length} chunks (${failed} failed)`)
  return { saved, failed }
}

/**
 * Process resource with hierarchical chunking
 */
export async function processResourceHierarchical(
  resourceId: string,
  resourceBody: string,
  spaceId: string
): Promise<{ saved: number; failed: number }> {
  console.log(`[Hierarchical Chunker] Processing resource ${resourceId}`)

  // Create chunks
  const chunks = await createHierarchicalChunks(resourceBody, resourceId, spaceId)

  // Save to database
  return await saveHierarchicalChunks(chunks)
}

// ============================================================================
// SEARCH
// ============================================================================

/**
 * Search hierarchical chunks
 */
export async function searchHierarchicalChunks(
  query: string,
  spaceId: string,
  level?: 'section' | 'passage' | 'sentence',
  limit: number = 10
): Promise<any[]> {
  // Generate query embedding
  const embedding = await embedText(query)

  // Search
  const { data, error } = await supabaseAdmin
    .rpc('search_hierarchical_chunks', {
      query_embedding: embedding,
      space_id_param: spaceId,
      level_param: level,
      match_threshold: 0.7,
      match_count: limit
    })

  if (error) {
    console.error('[Hierarchical Chunker] Search error:', error)
    return []
  }

  return data || []
}

