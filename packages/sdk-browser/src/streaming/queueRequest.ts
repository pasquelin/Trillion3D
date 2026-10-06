import type { Job, StreamContext } from './types.ts'
import { createJob } from './queueJob.ts'

/** The page when the cache holds it (a hit, touched), nothing when it does not (a miss, counted). */
export function answerFromCache(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array) => void,
  url: string,
) {
  const { state, cache, emit } = context
  const cached = cache.get(url)
  if (cached) {
    state.hits++
    touch(url, cached)
    emit?.('page-cache-hit', 'Page already resident', () => ({
      version: 1,
      url,
      resident: cache.size,
    }))
    return cached
  }
  state.misses++
  emit?.('page-cache-miss', 'Page missing from the cache', () => ({
    version: 1,
    url,
    resident: cache.size,
  }))
  return undefined
}

/** The job reading `url`: a new one, queued, or the one already reading it, raised to the
 *  urgency of this request. */
export function jobFor(
  context: StreamContext,
  sync: (url: string) => void,
  url: string,
  priority: number,
): Job {
  const { state, queue, jobs, emit, catalog } = context
  let job = jobs.get(url)
  if (!job) {
    job = createJob(url, priority, state.order++, catalog.get(url)!.bytes)
    jobs.set(url, job)
    sync(url)
    queue.push(job)
    return job
  }
  // A request that gains urgency climbs to its new place: a job already gone is no longer queued.
  if (priority < job.priority) {
    job.priority = priority
    queue.raise(job)
  }
  emit?.('page-request-coalesced', 'Request joined to a read in progress', () => ({
    version: 1,
    url,
    loading: jobs.size,
  }))
  return job
}

/** `job`'s last consumer left: still queued, it is taken out of the queue. A transfer already
 *  started is paid for: letting it land in the cache costs nothing more and keeps a superseded
 *  camera from throwing away bytes it is about to ask for again. */
export function dropQueued(
  context: StreamContext,
  url: string,
  job: Job,
  end: (url: string, job: Job) => void,
) {
  const { jobs, queue, emit, abortError } = context
  if (jobs.get(url) !== job || job.state !== 'queued') return
  end(url, job)
  job.controller.abort(abortError())
  emit?.('page-stream-abort', 'Pending request cancelled', () => ({ version: 1, url }))
  job.state = 'dropped'
  queue.remove(job)
}
