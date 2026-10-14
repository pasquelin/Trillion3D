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
  /** The lower tiers, served after the camera's: the casters the light cuts asked for, then the
   *  pages ahead of the camera, each highest priority first, without repeats (`lowerTier.ts`). */
  lowerTiers: () => readonly LowerList[]
  /** Starts a page's bytes read ahead of its admission, at PRIORITY_PREFETCH for the lower tiers. */
  prefetch?: (page: PageRec, signal: AbortSignal, priority?: number) => void
  /** Advanced whenever a page's bytes arrive or leave (`../row/journal.ts`, `touchRevision`). */
  bytesRevision: () => number
  /** The pages a holder brought into the root cover that the pool lacks (`coverHolders.ts`):
   *  loaded before the queue's. */
  coverMissing?: (holds: (page: PageRec) => boolean, limit?: number) => readonly PageRec[]
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
  for (const rec of covering)
    if (needsAdmit(s, run, rec) && !(await admitOne(s, run, rec, landed))) return
  for (let i = 0; i < wanted.length; i++) {
    readAhead()
    if (needsAdmit(s, run, wanted[i]) && !(await admitOne(s, run, wanted[i], landed))) return
  }
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

/** One page of the burst admitted (`needsAdmit` said so), unless the image no longer asks for it
 *  or the pool holds it once the share resumes; false once the pool is full. */
async function admitOne(s: EnsureState, run: EnsureRun, rec: PageRec, landed: () => void) {
  const { budget } = s
  // The share: past it the burst resumes after a task, nothing dropped — the page read again
  // against `wanted` and the pool, which a camera that moved in between may have changed. The clock
  // runs again first: a frame that ran during an await stopped it.
  budget.resume()
  if (!budget.admits()) {
    budget.pause()
    await s.nextShare()
    run.cache = currentCache(s)
    if (!asked(s, rec) || run.cache.get(pageAddress(rec))) {
      run.missing--
      return true
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
    if (!String(error).includes('POOL_FULL')) throw error
    // Pool full of pages the image holds: the burst stops there, without dropping anything.
    // What stays wanted displays through its resident ancestor; cut admission (`admitGpuCut`)
    // only reports that the image asks for more than the slots hold.
    run.full = true
    return false
  }
  run.cache = currentCache(s)
  return true
}

/** The pool after an await: lost with the device. */
function currentCache(s: EnsureState) {
  const cache = s.getCache()
  if (s.isLost() || !cache) throw new Error('WEBGPU_LOST')
  return cache
}
