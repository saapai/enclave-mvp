/**
 * Evaluation Harness
 * Test system quality against gold questions
 */

import { supabaseAdmin } from './supabase'
import { planQuery, executePlan, composeResponse } from './planner'
import { searchResourcesHybrid } from './search'

// ============================================================================
// TYPES
// ============================================================================

export interface GoldQuestion {
  id: string
  question: string
  category: string
  expected_answer: string
  expected_sources: string[]
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface EvalResult {
  gold_question_id: string
  actual_answer: string
  actual_sources: string[]
  score: 'correct' | 'partial' | 'incorrect' | 'no_answer'
  confidence: number
  retrieval_time_ms: number
  metadata?: Record<string, any>
}

export interface EvalRun {
  id?: string
  name: string
  space_id: string
  config: Record<string, any>
  total_questions: number
  correct_answers: number
  partial_answers: number
  incorrect_answers: number
  no_answers: number
  precision_at_1: number
  recall: number
  f1_score: number
  avg_confidence: number
  avg_retrieval_time_ms: number
}

// ============================================================================
// GOLD QUESTIONS
// ============================================================================

/**
 * Get gold questions for a workspace
 */
export async function getGoldQuestions(
  spaceId: string,
  category?: string
): Promise<GoldQuestion[]> {
  let query = supabaseAdmin
    .from('gold_question')
    .select('*')
    .eq('space_id', spaceId)
    .eq('active', true)

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query

  if (error) {
    console.error('[Eval] Error fetching gold questions:', error)
    return []
  }

  return data || []
}

/**
 * Add gold question
 */
export async function addGoldQuestion(
  spaceId: string,
  question: string,
  expectedAnswer: string,
  expectedSources: string[],
  category?: string,
  difficulty?: 'easy' | 'medium' | 'hard'
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('gold_question')
    .insert({
      space_id: spaceId,
      question,
      expected_answer: expectedAnswer,
      expected_sources: expectedSources,
      category,
      difficulty
    })
    .select('id')
    .single()

  if (error) {
    console.error('[Eval] Error adding gold question:', error)
    return null
  }

  return data.id
}

// ============================================================================
// EVALUATION
// ============================================================================

/**
 * Evaluate a single question
 */
async function evaluateQuestion(
  question: GoldQuestion,
  spaceId: string,
  usePlanner: boolean
): Promise<EvalResult> {
  const startTime = Date.now()

  try {
    let actualAnswer = ''
    let actualSources: string[] = []
    let confidence = 0

    if (usePlanner) {
      // Use planner flow
      const plan = await planQuery(question.question, spaceId)
      const toolResults = await executePlan(plan, spaceId)
      const composed = await composeResponse(question.question, plan, toolResults)

      actualAnswer = composed.text
      actualSources = composed.sources
      confidence = composed.confidence
    } else {
      // Use traditional search
      const results = await searchResourcesHybrid(question.question, spaceId, {}, { limit: 5 })

      if (results.length > 0) {
        actualAnswer = results[0].body?.substring(0, 300) || results[0].title
        actualSources = results.map(r => r.title)
        confidence = results[0].score || 0
      }
    }

    const retrievalTime = Date.now() - startTime

    // Score the result
    const score = scoreAnswer(
      actualAnswer,
      question.expected_answer,
      actualSources,
      question.expected_sources
    )

    return {
      gold_question_id: question.id,
      actual_answer: actualAnswer,
      actual_sources: actualSources,
      score,
      confidence,
      retrieval_time_ms: retrievalTime,
      metadata: {
        expected_answer: question.expected_answer,
        expected_sources: question.expected_sources
      }
    }

  } catch (error) {
    console.error(`[Eval] Error evaluating question "${question.question}":`, error)

    return {
      gold_question_id: question.id,
      actual_answer: '',
      actual_sources: [],
      score: 'no_answer',
      confidence: 0,
      retrieval_time_ms: Date.now() - startTime
    }
  }
}

/**
 * Score an answer
 */
function scoreAnswer(
  actualAnswer: string,
  expectedAnswer: string,
  actualSources: string[],
  expectedSources: string[]
): 'correct' | 'partial' | 'incorrect' | 'no_answer' {
  if (!actualAnswer || actualAnswer.length < 10) {
    return 'no_answer'
  }

  // Normalize for comparison
  const normalizedActual = actualAnswer.toLowerCase()
  const normalizedExpected = expectedAnswer.toLowerCase()

  // Check if expected answer is contained in actual answer
  const containsExpected = normalizedActual.includes(normalizedExpected)

  // Check source overlap
  const sourceOverlap = actualSources.filter(s =>
    expectedSources.some(es => s.toLowerCase().includes(es.toLowerCase()))
  ).length

  const sourceScore = sourceOverlap / Math.max(expectedSources.length, 1)

  // Scoring logic
  if (containsExpected && sourceScore >= 0.5) {
    return 'correct'
  } else if (containsExpected || sourceScore >= 0.3) {
    return 'partial'
  } else {
    return 'incorrect'
  }
}

/**
 * Run evaluation
 */
export async function runEvaluation(
  spaceId: string,
  config: {
    name?: string
    usePlanner?: boolean
    useReranking?: boolean
    category?: string
  } = {}
): Promise<EvalRun> {
  const {
    name = `Eval ${new Date().toISOString()}`,
    usePlanner = false,
    useReranking = false,
    category
  } = config

  console.log(`[Eval] Starting evaluation: ${name}`)
  console.log(`[Eval] Config: planner=${usePlanner}, reranking=${useReranking}`)

  // Get gold questions
  const questions = await getGoldQuestions(spaceId, category)
  console.log(`[Eval] Loaded ${questions.length} gold questions`)

  if (questions.length === 0) {
    throw new Error('No gold questions found')
  }

  // Create eval run
  const { data: runData, error: runError } = await supabaseAdmin
    .from('eval_run')
    .insert({
      name,
      space_id: spaceId,
      config: { usePlanner, useReranking, category },
      total_questions: questions.length,
      status: 'running'
    })
    .select('id')
    .single()

  if (runError || !runData) {
    throw new Error('Failed to create eval run')
  }

  const runId = runData.id
  console.log(`[Eval] Created eval run: ${runId}`)

  // Evaluate each question
  const results: EvalResult[] = []
  let correctCount = 0
  let partialCount = 0
  let incorrectCount = 0
  let noAnswerCount = 0
  let totalConfidence = 0
  let totalRetrievalTime = 0

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i]
    console.log(`[Eval] [${i + 1}/${questions.length}] Evaluating: "${question.question}"`)

    const result = await evaluateQuestion(question, spaceId, usePlanner)
    results.push(result)

    // Update counts
    if (result.score === 'correct') correctCount++
    else if (result.score === 'partial') partialCount++
    else if (result.score === 'incorrect') incorrectCount++
    else if (result.score === 'no_answer') noAnswerCount++

    totalConfidence += result.confidence
    totalRetrievalTime += result.retrieval_time_ms

    console.log(`[Eval]   → ${result.score} (confidence: ${result.confidence.toFixed(2)}, time: ${result.retrieval_time_ms}ms)`)

    // Save result
    await supabaseAdmin
      .from('eval_result')
      .insert({
        eval_run_id: runId,
        ...result
      })

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // Calculate metrics
  const accuracy = correctCount / questions.length
  const precision = (correctCount + partialCount * 0.5) / questions.length
  const recall = (correctCount + partialCount * 0.5) / questions.length
  const f1 = 2 * (precision * recall) / (precision + recall)

  const evalRun: EvalRun = {
    id: runId,
    name,
    space_id: spaceId,
    config: { usePlanner, useReranking, category },
    total_questions: questions.length,
    correct_answers: correctCount,
    partial_answers: partialCount,
    incorrect_answers: incorrectCount,
    no_answers: noAnswerCount,
    precision_at_1: accuracy,
    recall,
    f1_score: f1,
    avg_confidence: totalConfidence / questions.length,
    avg_retrieval_time_ms: Math.round(totalRetrievalTime / questions.length)
  }

  // Update eval run
  await supabaseAdmin
    .from('eval_run')
    .update({
      ...evalRun,
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', runId)

  console.log(`[Eval] Evaluation complete:`)
  console.log(`[Eval]   Correct: ${correctCount}/${questions.length} (${(accuracy * 100).toFixed(1)}%)`)
  console.log(`[Eval]   Partial: ${partialCount}`)
  console.log(`[Eval]   Incorrect: ${incorrectCount}`)
  console.log(`[Eval]   No Answer: ${noAnswerCount}`)
  console.log(`[Eval]   F1 Score: ${f1.toFixed(3)}`)
  console.log(`[Eval]   Avg Confidence: ${evalRun.avg_confidence.toFixed(2)}`)
  console.log(`[Eval]   Avg Time: ${evalRun.avg_retrieval_time_ms}ms`)

  return evalRun
}

/**
 * Get eval run results
 */
export async function getEvalRun(runId: string): Promise<any> {
  const { data, error } = await supabaseAdmin
    .rpc('get_eval_summary', { eval_run_id_param: runId })

  if (error) {
    console.error('[Eval] Error getting eval run:', error)
    return null
  }

  return data
}

