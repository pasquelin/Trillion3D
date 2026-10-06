import type { Job, StreamContext } from './types.ts';
import { createJob } from './queueJob.ts';
import { insereTravail } from './queueOrder.ts';

/** The page when the cache holds it (a hit, touched), nothing when it does not (a miss, counted). */
export function answerFromCache(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array) => void,
  url: string,
) {
  const { state, cache, emit } = context;
  const cached = cache.get(url);
  if (cached) {
    state.hits++;
    touch(url, cached);
    emit?.('page-cache-hit', 'Page already resident', () => ({
      version: 1,
      url,
      resident: cache.size,
    }));
    return cached;
  }
  state.misses++;
  emit?.('page-cache-miss', 'Page missing from the cache', () => ({
    version: 1,
    url,
    resident: cache.size,
  }));
  return undefined;
}

/** The job reading `url`: a new one, queued, or the one already reading it, raised to the
 *  urgency of this request. */
export function jobFor(
  context: StreamContext,
  sync: (url: string) => void,
  url: string,
  priority: number,
): Job {
  const { state, queue, jobs, emit } = context;
  let job = jobs.get(url);
  if (!job) {
    job = createJob(url, priority, state.order++);
    jobs.set(url, job);
    sync(url);
    insereTravail(queue, job);
    return job;
  }
  const raised = priority < job.priority;
  job.priority = raised ? priority : job.priority;
  // A request that gains urgency climbs: it is put back at its new place, the only
  // priority write that can disturb the order. A job already gone is no longer in the queue.
  if (raised && job.state === 'queued') {
    const at = queue.indexOf(job);
    if (at >= 0) {
      queue.splice(at, 1);
      insereTravail(queue, job);
    }
  }
  emit?.('page-request-coalesced', 'Request joined to a read in progress', () => ({
    version: 1,
    url,
    loading: jobs.size,
  }));
  return job;
}
