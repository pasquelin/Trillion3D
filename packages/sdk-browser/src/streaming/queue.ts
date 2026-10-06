import type { Job, RangedRead, StreamContext } from './types.ts'
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
  const { state, abort, catalog, emit, failures, abortError } = context
  const { end, forget, keep } = createQueueEnds(context, sync)
  const pump = createPump(context, loadOne, end, evict)
  /** A request the streamer, or its own `signal`, aborted is refused before it is queued. */
  const refused = (signal?: AbortSignal) =>
    state.disposed || abort.signal.aborted
      ? Promise.reject<Uint8Array>(abort.signal.reason ?? abortError())
      : signal?.aborted
        ? Promise.reject<Uint8Array>(signal.reason ?? abortError())
        : undefined
  /** One more consumer of `job` until it settles or `requestSignal` aborts, the queue pumped. */
  const enter = (job: Job, url: string, requestSignal?: AbortSignal) => {
    const combined = requestSignal ? AbortSignal.any([abort.signal, requestSignal]) : abort.signal
    const result = joinJob(job, url, combined, abortError, () => dropQueued(context, url, job, end))
    pump()
    return result
  }
  const subscribe = (
    url: string,
    requestSignal?: AbortSignal,
    priority = 1,
  ): Promise<Uint8Array> => {
    emit?.('page-request', 'Page request received', () => ({ version: 1, url, priority }))
    const refusal = refused(requestSignal)
    if (refusal) return refusal
    if (!catalog.has(url)) return Promise.reject(new Error('Unknown page ' + url))
    const failure = failures.get(url)
    if (failure) return Promise.reject(failure)
    const cached = answerFromCache(context, touch, url)
    if (cached) return Promise.resolve(cached)
    return enter(jobFor(context, sync, url, priority), url, requestSignal)
  }
  const ranged: RangedRead = (key, bytes, load, requestSignal, priority = 1) =>
    refused(requestSignal) ??
    enter(jobFor(context, sync, key, priority, { bytes, load }), key, requestSignal)
  return { pump, subscribe, ranged, forget, keep }
}
