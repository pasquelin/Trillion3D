import type { ViewReadbacks } from './readbackMerge.ts'
import { createRequestAdmission } from './requestAdmission.ts'
import { createLanding, followQueue, type QueueOptions, type QueueRun } from './queueJob.ts'

/** Follows the wanted set with one asynchronous uploader, and never rebuilds that set to do it. */
export function createWebgpuResidencyQueue(options: QueueOptions) {
  const { tracking, sets, ensureResident } = options
  const admitRequests = createRequestAdmission(sets, tracking, options.closure, options.recordOf)
  const q: QueueRun = {
    options,
    // The pages of the wanted set, one record per key: the queue is that set, not a copy of it.
    items: tracking.wantedPages,
    pending: Promise.resolve(),
    scheduled: false,
    running: false,
    job: 0,
    landing: createLanding(),
    // What a pass reads: the queue, the pool, the bytes, the lower tiers — monotonic counters;
    // those a pass that left nothing to do started from, and its pool: until they move, no job
    // runs — a still view walks no queue (NaN: none yet).
    inputs: () => sets.acceptedRevision + ensureResident.revision(),
    settledAt: NaN,
    settledCache: undefined,
  }
  return {
    items: q.items,
    /** The views' cuts: the queue keeps loading at full budget, admission reading their
     *  readbacks' requests in the GPU's order, coarsest first under a short pool; the rest is drawn
     *  by its nearest resident ancestor. */
    queueCuts(readbacks: ViewReadbacks) {
      admitRequests(options.room(), readbacks)
      followQueue(q)
    },
    /** The pool cannot hold the views' cuts whole: the GPU ranks their requests by admission. */
    short: () => admitRequests.short(options.room()),
    /** Bytes of the GPU cut's admission tables (`requestAdmission.ts`). */
    get hostBytes() {
      return admitRequests.hostBytes()
    },
    nextJobId: () => ++q.job,
    quietPending: () => void (q.pending = q.pending.catch(() => {})),
    get pending() {
      return q.pending
    },
    /**
     * The running job's next camera page made resident, or its end: what the next image can draw
     * already, a failure included. A loop waiting on it draws while a long job loads, the
     * view refining page by page, where waiting on `pending` shows the coarse cut until the job's
     * last page (#836).
     */
    progress: () => (q.running ? q.landing.next(q.pending) : q.pending),
    /** Camera pages made resident so far, every job counted: the view still arriving. */
    get landings() {
      return q.landing.landings
    },
    /** True while an upload is in flight or queued: residency can still change. */
    get busy() {
      return q.running || q.scheduled
    },
    get job() {
      return q.job
    },
  }
}
