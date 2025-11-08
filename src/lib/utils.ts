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
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    )
  ])
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

/**
 * Generate trace ID for request tracking
 */
export function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
