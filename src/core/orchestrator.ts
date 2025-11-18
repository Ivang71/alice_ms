import { TaskQueue } from './taskQueue.js'
import type { TaskPayload } from '../types.js'
import { debug } from './logger.js'

export const queue = new TaskQueue<TaskPayload>()

export async function orchestrateSearch(query: string, getAiAnswer: boolean): Promise<string> {
  const TOTAL_MS = Number(36000)
  const ATTEMPT_MS = Math.max(1000, Math.floor(TOTAL_MS / 4))
  const attemptParallel = (): Promise<string> => {
    const parallel = Math.max(1, Number(process.env.PARALLEL_REQUESTS || 2))
    debug('orchestrator_attempt_start', { query, getAiAnswer, parallel, timeoutMs: ATTEMPT_MS })
    const controllers = Array.from({ length: parallel }, () => new AbortController())
    const promises = controllers.map(c =>
      queue.enqueue({ query, timeoutMs: ATTEMPT_MS, getAiAnswer, signal: c.signal }) as Promise<string>
    )
    const raced = Promise.any<string>(promises)
    raced
      .then(text => {
        const len = text ? text.length : 0
        debug('orchestrator_attempt_ok', { query, getAiAnswer, parallel, timeoutMs: ATTEMPT_MS, textLen: len })
      })
      .catch(err => {
        debug('orchestrator_attempt_error', { query, getAiAnswer, parallel, timeoutMs: ATTEMPT_MS, error: (err as any)?.message || err })
      })
      .finally(() => { controllers.forEach(c => c.abort()) })
    return raced
  }
  try { return await attemptParallel() } catch {}
  try { return await attemptParallel() } catch {}
  try { return await attemptParallel() } catch {}
  return attemptParallel()
}


