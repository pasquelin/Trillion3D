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
  /** The session's side of the cache: its hold on a page follows its transfer (`sync`), a page
   *  that leaves the catalogue leaves the cache (`drop`) and its table's bytes the reserve
   *  (`tables`), and it evicts once a transfer settled. */
  pages: {
    sync(url: string): void
    drop(url: string): void
    tables(bytes: number): void
    evict(): void
  },
) {
  const { state, abort, catalog, emit, abortError, failures, queue } = context
  const { sync, evict } = pages
  const { end, forget, keep, forgotten } = createQueueEnds(context, pages)
  const pump = createPump(context, { read, end, evict, forgotten })
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
    requestSignal: AbortSignal,
    priority = 1,
  ): Promise<Uint8Array> => {
    emit?.('page-request', 'Page request received', () => ({ version: 1, url, priority }))
    if (state.disposed || abort.signal.aborted)
      return Promise.reject(abort.signal.reason ?? abortError())
    if (requestSignal.aborted) return Promise.reject(requestSignal.reason ?? abortError())
    if (!catalog.has(url)) return Promise.reject(new Error('Unknown page ' + url))
    // A read that failed for good is refused at once (`failures.ts`).
    const blocked = failures.blocked(url)
    if (blocked?.state === 'refused') return Promise.reject(blocked.error)
    const cached = answerFromCache(context, url)
    if (cached) return Promise.resolve(cached)
    const job = jobFor(context, sync, url, priority)
    // Its owner's signal alone: the streamer's own ends every job at once (`pageStreamer.ts`).
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
