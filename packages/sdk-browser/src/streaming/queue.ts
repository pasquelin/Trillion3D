import type { Job, StreamContext } from './types.ts'
import type { Landed } from './fetch.ts'
import { waitShared } from '../../../sdk-core/src/runtime/sharedRead.ts'
import { createPump } from './queueTransfer.ts'
import { createQueueEnds } from './queueEnds.ts'
import { answerFromCache, dropQueued, jobFor } from './queueRequest.ts'

/** The session's one read queue over `context`: each page asked joins its one job (`jobFor`),
 *  waited on by each asker till its own signal lets it go — the last to leave drops it while it
 *  waits (`dropQueued`) —, read by the transfers `read` makes. One pump a task: the reads asked
 *  within it are all queued, in their order, before a transfer takes them. */
export function createStreamingQueue(
  context: StreamContext,
  read: (jobs: readonly Job[], signal: AbortSignal) => Promise<Landed[]>,
  touch: (url: string, bytes: Uint8Array) => void,
  evict: () => void,
  /** Marks a page's hold in the cache's eviction order when its transfer starts or ends. */
  sync: (url: string) => void,
) {
  const { state, abort, catalog, emit, abortError, failures, queue } = context
  const { end, forget, keep } = createQueueEnds(context, sync)
  const pump = createPump(context, { read, end, evict })
  let owed = false
  const later = () => {
    if (owed) return
    owed = true
    queueMicrotask(() => {
      owed = false
      pump()
    })
  }
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
    // A read that failed for good is refused at once (`failures.ts`).
    const refused = failures.refusal(url)
    if (refused) return Promise.reject(refused)
    const cached = answerFromCache(context, touch, url)
    if (cached) return Promise.resolve(cached)
    const job = jobFor(context, sync, url, priority)
    // Its own signal alone: the streamer's ends every job at once (`pageStreamer.ts`), never a
    // listener an asker, which a signal heard by a hundred thousand would pay for each.
    const result = waitShared(job, requestSignal, () => dropQueued(context, url, job, end))
    later()
    return result
  }
  /** `job` waited out its last failure: queued again, its askers still waiting on it. */
  const requeue = (job: Job) => {
    job.state = 'queued'
    queue.push(job)
    later()
  }
  return { subscribe, forget, keep, requeue }
}
