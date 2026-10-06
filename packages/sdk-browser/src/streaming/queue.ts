import type { StreamContext } from './types.ts'
import { refusalOf } from './failures.ts'
import { joinJob } from './queueJob.ts'
import { createPump } from './queueTransfer.ts'
import { createQueueEnds } from './queueEnds.ts'
import { answerFromCache, dropQueued, jobFor } from './queueRequest.ts'

export function createStreamingQueue(
  context: StreamContext,
  loadOne: (url: string, signal: AbortSignal) => Promise<Uint8Array>,
  touch: (url: string, bytes: Uint8Array) => void,
  evict: () => void,
  /** Marks a page's hold in the cache's eviction order when its transfer starts or ends. */
  sync: (url: string) => void,
) {
  const { state, abort, catalog, emit, abortError } = context
  const { end, forget, keep } = createQueueEnds(context, sync)
  const pump = createPump(context, loadOne, end, evict)
  const subscribe = (
    url: string,
    requestSignal?: AbortSignal,
    priority = 1,
  ): Promise<Uint8Array> => {
    emit?.('page-request', 'Page request received', () => ({ version: 1, url, priority }))
    if (state.disposed || abort.signal.aborted)
      return Promise.reject(abort.signal.reason ?? abortError())
    if (requestSignal?.aborted) return Promise.reject(requestSignal.reason ?? abortError())
    if (!catalog.has(url)) return Promise.reject(new Error('Unknown page ' + url))
    // A read that failed is refused while it waits its turn, or for good (`failures.ts`).
    const failure = refusalOf(context, url)
    if (failure) return Promise.reject(failure)
    const cached = answerFromCache(context, touch, url)
    if (cached) return Promise.resolve(cached)
    const job = jobFor(context, sync, url, priority)
    const combined = requestSignal ? AbortSignal.any([abort.signal, requestSignal]) : abort.signal
    // Its last consumer gone while it waits, the job leaves the queue (`dropQueued`).
    const result = joinJob(job, url, combined, abortError, () => dropQueued(context, url, job, end))
    pump()
    return result
  }
  return { pump, subscribe, forget, keep }
}
