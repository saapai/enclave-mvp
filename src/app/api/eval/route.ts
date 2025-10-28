/**
 * Evaluation API
 * Run and view evaluation results
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { runEvaluation, getEvalRun, addGoldQuestion } from '@/lib/eval-harness'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for eval runs

/**
 * POST /api/eval
 * Run evaluation
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { spaceId, name, usePlanner, useReranking, category } = body

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId required' }, { status: 400 })
    }

    console.log(`[Eval API] Starting evaluation for workspace ${spaceId}`)

    const result = await runEvaluation(spaceId, {
      name,
      usePlanner,
      useReranking,
      category
    })

    return NextResponse.json({ result })

  } catch (error: any) {
    console.error('[Eval API] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/eval?runId=xxx
 * Get evaluation results
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('runId')

    if (!runId) {
      return NextResponse.json({ error: 'runId required' }, { status: 400 })
    }

    const result = await getEvalRun(runId)

    return NextResponse.json({ result })

  } catch (error) {
    console.error('[Eval API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

