import { pageAddress } from '../row/pageSlots.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { createLowerPass, LowerList, LowerPassOptions } from './lowerTier.ts'
import type { PageRec } from '../../page/selection/types.ts'
import type { GpuPageCache } from '../../gpu/page/pages.ts'
import type { WebgpuPageTracking } from '../row/pageTracking.ts'
import type { WebgpuDiagnosticChannel } from '../pages/io/diagnostics.ts'

/* The residency ensurer's camera burst (`./residentEnsurer.ts`): its options, its state and the
 * pages it admits in order, sharing the frame's clock. */

export type EnsureOptions = {
  getCache: () => GpuPageCache | undefined
  tracking: WebgpuPageTracking
  bootstrapKey: Uint8Array
  signal?: AbortSignal
  hasBytes: (page: PageRec) => boolean
  /** The pages a page depends on (`./admission.ts`): each is resident before the page is loaded. */
  parentsOf: (page: PageRec) => readonly PageRec[]
  isLost: () => boolean
  traceEnabled: boolean
  traceDiagnostic: WebgpuDiagnosticChannel['traceDiagnostic']
  /** The lower tier, served after the camera's: the pages ahead of the camera, highest priority
   *  first, without repeats (`lowerTier.ts`). */
  lowerTier: () => LowerList
  /** Starts a page's bytes read ahead of its admission, at PRIORITY_PREFETCH for the lower tiers. */
  prefetch?: (page: PageRec, signal: AbortSignal, priority?: number) => void
  /** Advanced whenever a page's bytes arrive or leave (`../row/journal.ts`, `touchRevision`). */
  bytesRevision: () => number
  /** The pages a holder brought into the root cover that the pool lacks (`coverHolders.ts`):
   *  loaded before the queue's. */
  coverMissing?: (holds: (page: PageRec) => boolean, limit: number) => readonly PageRec[]
  /** How many pages the cover's later holders brought that the pool may lack still. */
  coverLacking?: () => number
  /** The session's one main-thread clock (`WebgpuPagesRuntime.clock`): the queue spends what the
   *  frame's stages left. */
  clock: FrameClock
}

export type EnsureState = EnsureOptions &
  LowerPassOptions & { lower: ReturnType<typeof createLowerPass> }
/** One pass of `ensure`: its trace, the pool it reads, and what it left. */
export type EnsureRun = {
  frame: number
  jobId: number
  started: number
  urls: string[]
  cache: GpuPageCache
  /** Wanted pages this pass left out of the pool. */
  missing: number
  /** The pool is full of pages the image holds: the burst stopped there. */
  full: boolean
}

/** The camera's burst: every page a holder brought into the root cover, then every wanted page,
 *  not in the pool admitted, pinned, in order: nothing coarser stands in for the cover's. A page
 *  with nothing to admit is passed over at once (`needsAdmit`): only an admission awaits. */
export async function admitWanted(
  s: EnsureState,
  run: EnsureRun,
  wanted: readonly PageRec[],
  landed: () => void,
  reads: AbortSignal,
) {
  const { tracking } = s
  const wants = (rec: PageRec) => tracking.wanted.has(tracking.keyOf(rec))
  const pool = run.cache,
    room = pool.room()
  // The cover lists no more of its missing pages than the slots that could take them — a pool its
  // pins fill, none —, each still counted missing (`needsAdmit`).
  const covering = s.coverMissing?.((rec) => !!pool.get(pageAddress(rec)), room) ?? []
  if (room <= 0 && (s.coverLacking?.() ?? 0) > 0) run.missing++
  // `wanted` is the queue itself: the cut asks more pages while a burst awaits its loads, and
  // each load awaited one round trip alone would put the next page a round trip behind. The reads
  // start again for the pages the queue gained, before the next page is admitted.
  let ahead = -1
  const readAhead = () => {
    if (wanted.length === ahead) return
    ahead = wanted.length
    s.readAhead?.(wanted, run.cache.room(), wants, run.cache, reads)
  }
  readAhead()
  const walk: AdmitWalk = {
    before: (rec) => (needsAdmit(s, run, rec) ? 'admit' : 'skip'),
    // Past a share the page is read again against `wanted` and the pool, which a camera that moved
    // in between may have changed.
    resumed(rec) {
      run.cache = currentCache(s)
      if (asked(s, rec) && !run.cache.get(pageAddress(rec))) return 'admit'
      run.missing--
      return 'skip'
    },
    // A page whose parents lack their bytes is not loaded (-1): nothing to draw, no wake.
    admitted(taken) {
      if (taken > 0) {
        landed()
        run.missing--
      }
      run.cache = currentCache(s)
    },
  }
  // Pool full of pages the image holds: the burst stops there, without dropping anything. What
  // stays wanted displays through its resident ancestor; cut admission (`admitGpuCut`) only reports
  // that the image asks for more than the slots hold.
  run.full =
    !(await admitInOrder(s, covering, walk)) || !(await admitInOrder(s, wanted, walk, readAhead))
}

/** Whether the image still asks for `rec` — the queue or the root cover. */
const asked = (s: EnsureState, rec: PageRec) => {
  const key = s.tracking.keyOf(rec)
  return s.tracking.wanted.has(key) || s.bootstrapKey[key] > 0
}

/** Whether `rec` is one to admit now: asked, not in the pool, its bytes come. One asked and not
 *  pooled counts as missing, its bytes come or not. */
function needsAdmit(s: EnsureState, run: EnsureRun, rec: PageRec) {
  if (!asked(s, rec)) return false
  s.signal?.throwIfAborted()
  if (s.isLost()) throw new Error('WEBGPU_LOST')
  if (run.cache.get(pageAddress(rec))) return false
  run.missing++
  return s.hasBytes(rec)
}

/** What a walk of `admitInOrder` does with a page: admits it, passes it over, or ends the walk. */
export type AdmitStep = 'admit' | 'skip' | 'leave'
/** How a tier walks `admitInOrder`: a page's step before it (`before`) and once a share was awaited
 *  (`resumed`), what its admission took (`admitted`: the slots, -1 for a page whose parents lack
 *  their bytes), and the priority of its reads — the camera's own unless given. */
export type AdmitWalk = {
  before: (rec: PageRec) => AdmitStep
  resumed: (rec: PageRec) => AdmitStep
  admitted: (taken: number) => void
  priority?: number
}

/**
 * THE ONE ADMISSION LOOP of the residency queue, the camera's burst and the lower tiers' fill
 * alike: `list` in order, `each` called before every page, each page the walk admits loaded through
 * the install order (`./admission.ts`). The share (`share.ts`) is awaited before an admission: past
 * it the job resumes after a task, nothing dropped, and the page is asked again (`resumed`). False
 * once the pool is full of pages the image holds: the walk stops there.
 */
export async function admitInOrder(
  s: Pick<LowerPassOptions, 'share' | 'admit' | 'budget'>,
  list: readonly PageRec[],
  walk: AdmitWalk,
  each?: () => void,
) {
  for (let i = 0; i < list.length; i++) {
    each?.()
    const rec = list[i]
    let step = walk.before(rec)
    if (step === 'admit') {
      const shared = s.share()
      if (shared) {
        await shared
        step = walk.resumed(rec)
      }
    }
    if (step === 'leave') return true
    if (step === 'skip') continue
    try {
      walk.admitted(await s.admit(rec, walk.priority))
      s.budget.spend()
    } catch (error) {
      if (!String(error).includes('POOL_FULL')) throw error
      return false
    }
  }
  return true
}

/** The pool after an await: lost with the device. */
function currentCache(s: EnsureState) {
  const cache = s.getCache()
  if (s.isLost() || !cache) throw new Error('WEBGPU_LOST')
  return cache
}
