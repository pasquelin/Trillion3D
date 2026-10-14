import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { STREAMING_SHARES_PER_FRAME } from '../../engine/common.ts'
import { createSharePace } from '../../page/integration/frameBudget.ts'
import { pageAddress } from '../row/pageSlots.ts'
import { createAdmissionReads, createPageAdmission } from './admission.ts'
import { createLowerPass } from './lowerTier.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { admitWanted, type EnsureOptions, type EnsureRun, type EnsureState } from './ensureBurst.ts'

/** Loads newly wanted pages without acting on a stale camera cut. */
export function createWebgpuResidentEnsurer(options: EnsureOptions) {
  const { getCache, hasBytes, parentsOf, prefetch, lowerTiers, bytesRevision } = options
  /** The frame's main-thread clock: past what it leaves a job yields a task, past
   *  `STREAMING_SHARES_PER_FRAME` of a visible page a frame. A share between two frames spends what
   *  the frame's stages left; a page whose frames do not come — nothing opens the clock — opens it. */
  const budget = options.clock
  const nextShare = createSharePace(
    (framed) => (framed ? budget.stage() : void budget.open()),
    STREAMING_SHARES_PER_FRAME,
  )
  /** The reads a pass starts before its admissions, under the job's `reads`; none without `prefetch`. */
  const readAhead = prefetch && createAdmissionReads({ hasBytes, parentsOf, prefetch })
  /** Every load of both tiers goes through the install order; what the image holds is pinned. */
  const admit = createPageAdmission(options)
  const parts = { ...options, budget, nextShare, readAhead, admit }
  const state: EnsureState = { ...parts, lower: createLowerPass(parts) }
  /**
   * `cameraWaiting` says a camera cut queued behind this job: the caster tier gives way to it.
   * Resolves true when the pass left nothing to do — every wanted page resident, every lower tier
   * page held —: until what it reads moves (`revision`), another pass would do nothing.
   */
  const ensure = (
    wanted: readonly PageRec[],
    jobFrame: number,
    jobId: number,
    cameraWaiting: () => boolean = () => false,
    landed: () => void = () => {},
  ) => ensurePass(state, wanted, jobFrame, jobId, cameraWaiting, landed)
  return Object.assign(ensure, {
    /** Advanced whenever what a pass reads may have moved: the pool's pages, a page's bytes, a
     *  lower tier's report. The upload queue's own revision is the caller's (`queue.ts`). */
    revision: () =>
      (getCache()?.residencyRevision ?? 0) +
      bytesRevision() +
      lowerTiers().reduce((sum, tier) => sum + tier.revision, 0),
  })
}

async function ensurePass(
  s: EnsureState,
  wanted: readonly PageRec[],
  frame: number,
  jobId: number,
  cameraWaiting: () => boolean,
  landed: () => void,
) {
  const cache = s.getCache()
  if (!cache) return
  const started = cpuNow(),
    urls = s.traceEnabled ? wanted.map(pageAddress) : []
  const run: EnsureRun = { frame, jobId, started, urls, cache, missing: 0, full: false }
  s.traceDiagnostic('residency-ensure-start', 'GPU residency check requested', () =>
    tracePayload(s, run, {
      wanted: s.tracking.traceSet('ensure.wanted', urls),
      loaded: loadedSet(s, run),
      queueWaitMs: null,
      elapsedMs: null,
    }),
  )
  // The reads the job starts and no load joins — pages it does not reach — leave the queue. The
  // job is a stage of the frame's clock: its first page is admitted, and the clock stops with it.
  const reads = new AbortController()
  s.budget.stage()
  try {
    await admitWanted(s, run, wanted, landed, reads.signal)
    const lower = run.full ? [] : s.lower.list()
    if (lower.length) await s.lower.load(lower, run.cache, cameraWaiting, reads.signal)
  } finally {
    s.budget.pause()
    reads.abort()
  }
  s.traceDiagnostic('residency-ensure-end', 'GPU residency checked', () => ({
    ...tracePayload(s, run, {
      loaded: loadedSet(s, run),
      elapsedMs: msSince(started),
    }),
    // Bounded probe of the pinned set: it has the size of the cut, not of the queue.
    pinned: run.cache.stats().pinned,
  }))
  return run.missing === 0 && s.getCache() === run.cache && s.lower.held(run.cache)
}

function loadedSet(s: EnsureState, run: EnsureRun) {
  return s.tracking.traceSet(
    'ensure.loaded',
    run.urls.filter((url) => !!run.cache.get(url)),
  )
}

function tracePayload<T extends object>(s: EnsureState, run: EnsureRun, extra: T) {
  return {
    frame: run.frame,
    jobId: run.jobId,
    scope: 'async-residency-ensure',
    pages: s.tracking.traceSet('ensure', run.urls),
    ...extra,
    cpuWorkIncluded: true,
    gpuQueueWaitIncluded: false,
  }
}
