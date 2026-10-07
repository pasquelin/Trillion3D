import type { PageRec } from '../../page/selection/selection.ts'
import type { createGpuPageCache } from '../../gpu/page/pages.ts'
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import type { WebgpuResidencySets } from './sets.ts'
import { pageAddress } from '../row/pageSlots.ts'
import type { GroupClosure } from '../../page/cut/groupClosure.ts'

type Cache = ReturnType<typeof createGpuPageCache>
type Diagnostics = ReturnType<typeof createWebgpuDiagnostics>
type Tracking = ReturnType<typeof createWebgpuPageTracking>
export type QueueOptions = {
  tracking: Tracking
  sets: WebgpuResidencySets
  /** A packed rank's record: admission reads a request's level there. */
  recordOf: (id: number) => PageRec | undefined
  /** Slots the queue can ask beyond root coverage, read every cut. */
  room: () => number
  getCache: () => Cache | undefined
  getFrame: () => number
  updatePins: () => void
  /** The groups the cut closes over: what admission walks (`requestAdmission.ts`). */
  closure: Pick<GroupClosure, 'closeOver'>
  /** A pass over the queue (`residentEnsurer.ts`): true when it left nothing to do, which stands
   *  while neither the queue nor its `revision` moves; `touchLower` is what a pass would still do. */
  ensureResident: ((
    wanted: readonly PageRec[],
    frame: number,
    jobId: number,
    cameraWaiting: () => boolean,
    landed: () => void,
  ) => Promise<boolean | void>) & { revision: () => number; touchLower: () => void }
  markLost: (error: unknown) => void
  traceEnabled: boolean
  traceDiagnostic: Diagnostics['traceDiagnostic']
  diagnosticFailure: Diagnostics['diagnosticFailure']
}

/** What the queue's job and its face share (`createWebgpuResidencyQueue`). */
export type QueueRun = {
  options: QueueOptions
  items: Tracking['wantedPages']
  pending: Promise<unknown>
  scheduled: boolean
  running: boolean
  job: number
  landing: ReturnType<typeof createLanding>
  inputs: () => number
  settledAt: number
  settledCache: Cache | undefined
}

/**
 * The running job's next camera page (`progress`), one wait shared by every frame until a page
 * lands and wakes it, or the job ends (`pending`, its failure included); none is made while nobody
 * waits. A page landed while nobody waited (`unheard`) answers the next wait at once, so it is
 * drawn without the next one.
 */
export function createLanding() {
  let next: Promise<unknown> | undefined,
    wake: (() => void) | undefined,
    unheard = false
  const landing = {
    landings: 0,
    landed: () => {
      landing.landings++
      unheard = !wake
      wake?.()
      next = wake = undefined
    },
    /** The next landing, or the end of `pending`, whichever comes first. */
    next(pending: Promise<unknown>) {
      if (unheard) {
        unheard = false
        return Promise.resolve()
      }
      return (next ??= Promise.race([pending, new Promise<void>((woken) => (wake = woken))]))
    },
    /** The job ended: no wait stands, nothing unheard. */
    reset() {
      next = wake = undefined
      unheard = false
    },
  }
  return landing
}

/** The queue followed: pins updated, then a job queued unless the last pass settled what it
 *  reads, or one already runs and will run again. */
export function followQueue(q: QueueRun) {
  const { tracking, getCache, getFrame, updatePins, ensureResident, traceEnabled } = q.options
  updatePins()
  const settled = !q.running && q.settledAt === q.inputs() && q.settledCache === getCache()
  if (settled) return ensureResident.touchLower()
  const queuedAt = performance.now(),
    jobId = ++q.job,
    jobFrame = getFrame()
  q.scheduled = true
  if (traceEnabled)
    q.options.traceDiagnostic('residency-queue', 'GPU residency queued', () => ({
      frame: jobFrame,
      jobId,
      pages: tracking.traceRecs('queue', q.items),
      wanted: tracking.traceKeys('wanted', tracking.wanted),
      loaded: tracking.traceRecs(
        'queue.loaded',
        q.items.filter((rec) => !!getCache()?.get(pageAddress(rec))),
      ),
      queueDepth: q.items.length,
      residentPages: getCache()?.stats().residentPages ?? null,
    }))
  if (q.running) return
  q.running = true
  q.pending = Promise.resolve().then(() => runJob(q, { jobFrame, jobId, queuedAt }))
  void q.pending.catch(() => {})
}

/** The job: passes over the queue while one is scheduled, each yielding its caster tier to a cut
 *  queued meanwhile; a failure withdraws the device when it is lost, and is reported. */
async function runJob(q: QueueRun, at: { jobFrame: number; jobId: number; queuedAt: number }) {
  const { tracking, getCache, ensureResident, traceDiagnostic } = q.options
  const { jobFrame, jobId, queuedAt } = at
  const started = performance.now()
  traceDiagnostic('residency-job-start', 'GPU residency job started', () => ({
    frame: jobFrame,
    jobId,
    scope: 'async-residency-job',
    queueWaitMs: started - queuedAt,
    pages: tracking.traceRecs('job', q.items),
    elapsedMs: null,
    cpuWorkIncluded: true,
    gpuQueueWaitIncluded: false,
  }))
  try {
    while (q.scheduled) {
      q.scheduled = false
      const from = q.inputs(),
        cache = getCache()
      // The job yields its caster tier to a cut queued meanwhile, and runs again for it.
      const scheduled = () => q.scheduled
      const done = await ensureResident(q.items, jobFrame, jobId, scheduled, q.landing.landed)
      q.settledAt = done === true ? from : NaN
      q.settledCache = cache
    }
  } catch (error) {
    q.settledAt = NaN
    // The withdrawal precedes the report: a host reading the canvas finds nothing stale.
    if (/LOST|DISPOSED/i.test(String(error))) q.options.markLost(error)
    q.options.diagnosticFailure('coverage-upload-failed', error)
    throw error
  } finally {
    q.running = false
    q.landing.reset()
    traceDiagnostic('residency-job-end', 'GPU residency job finished', () => ({
      frame: jobFrame,
      jobId,
      scope: 'async-residency-job',
      durationMs: performance.now() - started,
      elapsedMs: performance.now() - queuedAt,
      // The requested set is sampled by a bounded probe, and what the cache holds of it is the
      // count it already holds: filtering the whole set walked it twice more.
      pages: tracking.traceKeys('job', tracking.wanted),
      residentPages: getCache()?.stats().residentPages ?? null,
      queueWaitMs: started - queuedAt,
      cpuWorkIncluded: true,
      gpuQueueWaitIncluded: false,
    }))
  }
}
