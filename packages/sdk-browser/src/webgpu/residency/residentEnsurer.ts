import { STREAMING_FRAME_MS, STREAMING_SHARES_PER_FRAME } from '../../engine/common.ts'
import { createFrameBudget, createSharePace } from '../../page/integration/frameBudget.ts'
import { pageAddress } from '../row/pageSlots.ts'
import { createAdmissionReads, createPageAdmission } from './admission.ts'
import { createLowerPass, type LowerList, type LowerPassOptions } from './lowerTier.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { createGpuPageCache } from '../../gpu/page/pages.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts'
type Cache = ReturnType<typeof createGpuPageCache>
type Tracking = ReturnType<typeof createWebgpuPageTracking>
type Trace = ReturnType<typeof createWebgpuDiagnostics>['traceDiagnostic']
type EnsureOptions = {
  getCache: () => Cache | undefined
  tracking: Tracking
  bootstrapKey: Uint8Array
  signal?: AbortSignal
  hasBytes: (page: PageRec) => boolean
  /** The pages a page depends on (`./admission.ts`): each is resident before the page is loaded. */
  parentsOf: (page: PageRec) => readonly PageRec[]
  isLost: () => boolean
  traceEnabled: boolean
  traceDiagnostic: Trace
  /** The lower tiers, served after the camera's: the casters the light cuts asked for, then the
   *  pages ahead of the camera, each highest priority first, without repeats (`lowerTier.ts`). */
  lowerTiers: () => readonly LowerList[]
  /** Starts a page's bytes read ahead of its admission, at PRIORITY_PREFETCH for the lower tiers. */
  prefetch?: (page: PageRec, signal: AbortSignal, priority?: number) => void
  /** Advanced whenever a page's bytes arrive or leave (`../row/journal.ts`, `touchRevision`). */
  bytesRevision: () => number
  /** The pages a holder brought into the root cover that the pool lacks (`coverHolders.ts`):
   *  loaded before the queue's. */
  coverMissing?: (holds: (page: PageRec) => boolean) => readonly PageRec[]
}

type EnsureState = EnsureOptions & LowerPassOptions & { lower: ReturnType<typeof createLowerPass> }
/** One pass of `ensure`: its trace, the pool it reads, and what it left. */
type EnsureRun = {
  frame: number
  jobId: number
  started: number
  urls: string[]
  cache: Cache
  /** Wanted pages this pass left out of the pool. */
  missing: number
  /** The pool is full of pages the image holds: the burst stopped there. */
  full: boolean
}

/** Loads newly wanted pages without acting on a stale camera cut. */
export function createWebgpuResidentEnsurer(options: EnsureOptions) {
  const { getCache, hasBytes, parentsOf, prefetch, lowerTiers, bytesRevision } = options
  /** The published share of the main thread (`STREAMING_FRAME_MS`): past it a job yields a task,
   *  past `STREAMING_SHARES_PER_FRAME` of a visible page a frame, and opens a new share. */
  const budget = createFrameBudget(STREAMING_FRAME_MS)
  const nextShare = createSharePace(budget.open, STREAMING_SHARES_PER_FRAME)
  /** The reads a pass starts before its admissions, under the job's `reads`; none without `prefetch`. */
  const readAhead = prefetch && createAdmissionReads({ hasBytes, parentsOf, prefetch })
  /** Every load of both tiers goes through the install order; what the image holds is pinned. */
  const admit = createPageAdmission(options)
  const parts = { ...options, budget, nextShare, readAhead, admit }
  const state: EnsureState = { ...parts, lower: createLowerPass(parts) }
  /**
   * `cameraWaiting` says a camera cut queued behind this job: the caster tier gives way to it.
   * Resolves true when the pass left nothing to do — every wanted page resident, every lower tier
   * page held —: until what it reads moves (`revision`), another pass would only touch the lower
   * tiers' pages (`touchLower`).
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
    touchLower: state.lower.touch,
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
  const started = performance.now(),
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
  // The reads the job starts and no load joins — pages it does not reach — leave the queue.
  const reads = new AbortController()
  try {
    await admitWanted(s, run, wanted, landed, reads.signal)
    const lower = run.full ? [] : s.lower.list()
    if (lower.length) await s.lower.load(lower, run.cache, cameraWaiting, reads.signal)
  } finally {
    reads.abort()
  }
  s.traceDiagnostic('residency-ensure-end', 'GPU residency checked', () => ({
    ...tracePayload(s, run, {
      loaded: loadedSet(s, run),
      durationMs: performance.now() - started,
      elapsedMs: performance.now() - started,
    }),
    // Bounded probe of the pinned set: it has the size of the cut, not of the queue.
    pinned: s.tracking.traceKeys('pins', s.tracking.pinned),
  }))
  return run.missing === 0 && s.getCache() === run.cache && s.lower.held(run.cache)
}

/** The camera's burst: every page a holder brought into the root cover, then every wanted page,
 *  not in the pool admitted, pinned, in order: nothing coarser stands in for the cover's. */
async function admitWanted(
  s: EnsureState,
  run: EnsureRun,
  wanted: readonly PageRec[],
  landed: () => void,
  reads: AbortSignal,
) {
  const { tracking, budget, bootstrapKey } = s
  const wants = (rec: PageRec) => tracking.wanted.has(tracking.keyOf(rec)),
    asked = (key: number) => tracking.wanted.has(key) || bootstrapKey[key] > 0
  const pool = run.cache,
    covering = s.coverMissing?.((rec) => !!pool.get(pageAddress(rec))) ?? []
  s.readAhead?.(wanted, run.cache.unpinnedSlots(), wants, run.cache, reads)
  for (let i = 0; i < covering.length + wanted.length; i++) {
    const rec = i < covering.length ? covering[i] : wanted[i - covering.length],
      key = tracking.keyOf(rec),
      address = pageAddress(rec)
    if (!asked(key)) continue
    s.signal?.throwIfAborted()
    if (s.isLost()) throw new Error('WEBGPU_LOST')
    if (run.cache.get(address)) continue
    run.missing++
    if (!s.hasBytes(rec)) continue
    // The share: past it the burst resumes after a task, nothing dropped — the page read again
    // against `wanted` and the pool, which a camera that moved in between may have changed.
    if (!budget.admits()) {
      await s.nextShare()
      run.cache = currentCache(s)
      if (!asked(key) || run.cache.get(address)) {
        run.missing--
        continue
      }
    }
    try {
      // A page whose parents lack their bytes is not loaded (-1): nothing to draw, no wake.
      if ((await s.admit(rec)) > 0) {
        landed()
        run.missing--
      }
      budget.spend()
    } catch (error) {
      if (!String(error).includes('ALL_PAGES_PINNED')) throw error
      // Pool full of pages the image holds: the burst stops there, without dropping anything.
      // What stays wanted displays through its resident ancestor; cut admission (`admitGpuCut`)
      // only reports that the image asks for more than the slots hold.
      run.full = true
      return
    }
    run.cache = currentCache(s)
  }
}

/** The pool after an await: lost with the device. */
function currentCache(s: EnsureState) {
  const cache = s.getCache()
  if (s.isLost() || !cache) throw new Error('WEBGPU_LOST')
  return cache
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
