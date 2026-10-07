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

/** The job reading `url`: a new one — queued, or waiting its turn while the wait of its last
 *  failure runs (`failures.ts`) —, or the one already reading it, raised to the urgency of this
 *  request. */
export function jobFor(
  context: StreamContext,
  sync: (url: string) => void,
  url: string,
  priority: number,
): Job {
  const { state, queue, jobs, emit, catalog, failures } = context
  let job = jobs.get(url)
  if (!job) {
    job = createJob(catalog.get(url)!, priority, state.order++)
    jobs.set(url, job)
    sync(url)
    if (failures.waiting(url)) job.state = 'waiting'
    else queue.push(job)
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

/** `job`'s last asker left: queued, or waiting its turn after a failure, it is dropped. A page
 *  under way is paid for and lands, every page alike: a view that asks it again meanwhile — a
 *  camera turning back, a cell held again — joins its read rather than starting it anew, and the
 *  cache keeps it for a later ask unless its askers keep it (`StreamPage.kept`). */
export function dropQueued(
  context: StreamContext,
  url: string,
  job: Job,
  end: (url: string, job: Job) => void,
) {
  const { jobs, queue, emit } = context
  if (jobs.get(url) !== job || job.state === 'active') return
  end(url, job)
  emit?.('page-stream-abort', 'Pending request cancelled', () => ({ version: 1, url }))
  queue.remove(job)
}
