import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Timeout wrapper for promises - prevents hangs
 */
export async function pTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'op'
): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
      })
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/**
 * Safe Promise.allSettled wrapper that filters to fulfilled results
 */
export async function safeAll<T>(
  promises: Array<Promise<T>>
): Promise<T[]> {
  const results = await Promise.allSettled(promises)
  return results
    .filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled')
    .map((r) => r.value)
}

export async function raceBudget<T>(
  tasks: Array<() => Promise<T>>,
  budgetMs: number,
  label = 'race'
): Promise<T[]> {
  const start = Date.now()
  const outputs: T[] = []

  for (let i = 0; i < tasks.length; i += 1) {
    const elapsed = Date.now() - start
    const remaining = budgetMs - elapsed

    if (remaining <= 0) {
      console.warn(`[Utils] ${label} budget exhausted after ${elapsed}ms (task ${i})`)
      break
    }

    try {
      const perTaskBudget = Math.max(50, remaining)
      const result = await pTimeout(tasks[i](), perTaskBudget, `${label}:task${i}`)
      outputs.push(result)
    } catch (err) {
      console.error(`[Utils] ${label} task ${i} failed:`, err)
    }
  }

  return outputs
}

/**
 * Generate trace ID for request tracking
 */
export function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
