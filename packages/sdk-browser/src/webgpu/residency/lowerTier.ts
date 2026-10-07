import type { PageRec } from '../../page/selection/selection.ts'
import { createSparseInts } from '../../page/cut/sparseInts.ts'
import type { createFrameBudget } from '../../page/integration/frameBudget.ts'
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts'
import type { createGpuPageCache } from '../../gpu/page/pages.ts'
import { pageAddress } from '../row/pageSlots.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import type { createAdmissionReads, createPageAdmission } from './admission.ts'
type Cache = ReturnType<typeof createGpuPageCache>
type Tracking = ReturnType<typeof createWebgpuPageTracking>

/**
 * A lower residency tier: pages a cut asked for below the camera's own — the pages ahead of the
 * camera —, in their order — highest replacement error first — each with the groups it
 * closes over (`../../page/cut/groupClosure.ts`), without repeats, and no longer than the pool. The
 * camera's tier is served first and pinned; a lower one only fills what the camera leaves
 * (`residentEnsurer.ts`).
 *
 * The list is replaced whole each time its source reports: the view ahead reports with every
 * readback, an empty list once the camera stops.
 */
export function createLowerTier(options: {
  keyOf: (page: PageRec) => number
  room: () => number
  closeOver: (
    ids: ArrayLike<number>,
    visit: (id: number, rec: PageRec) => void,
    full?: () => boolean,
  ) => void
}) {
  const { keyOf, room, closeOver } = options
  const pages: PageRec[] = []
  /** The keys of the last report: as many as it names, never the catalogue. */
  const named = createSparseInts()
  let revision = 0
  const begin = () => {
    pages.length = 0
    named.clear()
    revision++
  }
  /** The list holds the pool: the rest of a report is not walked (a view ahead names up to half
   *  the sample each readback). */
  const full = () => pages.length >= room()
  const push = (_id: number, rec: PageRec) => {
    if (full()) return
    const key = keyOf(rec)
    if (named.set(key, 1)) return
    pages.push(rec)
  }
  return {
    pages,
    /** Advanced by every report: the merge of the tiers is remade only then (`createLowerMerge`). */
    get revision() {
      return revision
    },
    /** True when the last report names this key: a page this tier still wants. */
    has: (key: number) => named.has(key),
    /** Bytes of the tier's tables, read in constant time: its keys, and one 8-byte slot per entry
     *  of its list — bounded by the pool, never the catalogue. */
    get hostBytes() {
      return named.byteLength + pages.length * 8
    },
    /** A GPU cut's requests: page indices of the packed catalogue. */
    offerIds(requested: ArrayLike<number>) {
      begin()
      closeOver(requested, push, full)
    },
  }
}

/** A tier as the residency ensurer reads it: its pages, the keys it names — true when its last
 *  report names the key, a page it still wants —, and a revision each report advances. */
export type LowerList = {
  pages: readonly PageRec[]
  has: (key: number) => boolean
  revision: number
}

/**
 * One job's lower tiers in order, each page once: a page an earlier tier names — a caster also
 * ahead of the camera — is counted and loaded once. A copy: a tier's list is rewritten in place by
 * every report taken while a job loads, and a loop resumed on another list keeps neither its order
 * nor its count of free slots. One list, made anew only when a tier reported since: the jobs that
 * follow one another between two reports read it as it is, and a job still walking the one before
 * — a capture's `ensureResident` runs beside the queue — keeps it whole.
 */
export function createLowerMerge(keyOf: (page: PageRec) => number) {
  let list: PageRec[] = []
  let seen: (readonly [LowerList, number])[] = []
  const current = (tiers: readonly LowerList[]) =>
    seen.length === tiers.length &&
    tiers.every((tier, t) => seen[t][0] === tier && seen[t][1] === tier.revision)
  return (tiers: readonly LowerList[]): readonly PageRec[] => {
    if (current(tiers)) return list
    seen = tiers.map((tier) => [tier, tier.revision] as const)
    list = []
    for (let t = 0; t < tiers.length; t++)
      for (const rec of tiers[t].pages) {
        const key = keyOf(rec)
        let named = false
        for (let earlier = 0; earlier < t && !named; earlier++) named = tiers[earlier].has(key)
        if (!named) list.push(rec)
      }
    return list
  }
}

export type LowerPassOptions = {
  getCache: () => Cache | undefined
  tracking: Pick<Tracking, 'keyOf' | 'wanted'>
  bootstrapKey: Uint8Array
  signal?: AbortSignal
  hasBytes: (page: PageRec) => boolean
  isLost: () => boolean
  lowerTiers: () => readonly LowerList[]
  admit: ReturnType<typeof createPageAdmission>
  budget: ReturnType<typeof createFrameBudget>
  nextShare: () => Promise<void>
  readAhead: ReturnType<typeof createAdmissionReads> | undefined
}
type LowerPass = LowerPassOptions & { skips: (rec: PageRec) => boolean }

/** The lower tiers' pass of the residency ensurer (`residentEnsurer.ts`): their merged list, its
 *  load into what the camera left, whether it leaves work, and the touch a settled pass still does. */
export function createLowerPass(options: LowerPassOptions) {
  const { getCache, tracking, bootstrapKey, hasBytes, lowerTiers } = options
  const mergeLower = createLowerMerge(tracking.keyOf)
  /** Whether a lower tier page is not the tiers' to load: wanted by the camera, pinned, or without
   *  its bytes. */
  const skips = (rec: PageRec) => {
    const key = tracking.keyOf(rec)
    return tracking.wanted.has(key) || !!bootstrapKey[key] || !hasBytes(rec)
  }
  const pass: LowerPass = { ...options, skips }
  return {
    list: () => mergeLower(lowerTiers()),
    load: (
      lower: readonly PageRec[],
      cache: Cache,
      cameraWaiting: () => boolean,
      reads: AbortSignal,
    ) => loadLowerTiers(pass, lower, cache, cameraWaiting, reads),
    /** True when every lower tier page is held, or left to the camera: the tiers leave no work. */
    held: (cache: Cache) =>
      mergeLower(lowerTiers()).every((rec) => skips(rec) || !!cache.get(pageAddress(rec))),
    /** What a pass that finds nothing to do still does: the lower tiers' pages touched, so the
     *  pool's order of eviction is the one a pass would have left. */
    touch() {
      const cache = getCache()
      if (!cache) return
      for (const rec of mergeLower(lowerTiers()))
        if (!skips(rec)) cache.touch(pageAddress(rec), true)
    },
  }
}

/**
 * What the camera left: the lower tiers' pages — the pages ahead of the camera —, loaded only
 * into slots nobody holds — free, or taken by a page no tier wants. They are never pinned: a
 * camera page evicts them, they never evict a camera page, and an object on screen is never
 * coarsened for a view to come. A tier keeps every page its list still names, so a wanted page is
 * never evicted and reloaded each frame (#1016).
 */
async function loadLowerTiers(
  pass: LowerPass,
  lower: readonly PageRec[],
  cache: Cache,
  cameraWaiting: () => boolean,
  reads: AbortSignal,
) {
  const { skips, budget, signal } = pass
  let spare = cache.unpinnedSlots()
  for (let i = 0; i < lower.length; i++)
    if (!skips(lower[i]) && cache.touch(pageAddress(lower[i]), true)) spare--
  pass.readAhead?.(lower, spare, (rec) => !skips(rec), cache, reads, PRIORITY_PREFETCH)
  // The share, as the camera's burst: past it the job yields — and leaves if a camera cut asked
  // for pages meanwhile: the queue serves the camera first and runs the tiers again. A job only
  // ends on a tier pass nobody interrupted, so every wait on it finds the tiers posted (#281).
  for (let i = 0; i < lower.length && spare > 0; i++) {
    if (!budget.admits()) {
      await pass.nextShare()
      if (cameraWaiting()) return
    }
    const rec = lower[i],
      address = pageAddress(rec)
    if (skips(rec) || cache.get(address)) continue
    signal?.throwIfAborted()
    if (pass.isLost() || pass.getCache() !== cache) return
    try {
      spare -= Math.max(0, await pass.admit(rec, PRIORITY_PREFETCH))
      budget.spend()
    } catch (error) {
      // The camera's own burst took the last slot meanwhile: the tier waits, as it does.
      if (String(error).includes('ALL_PAGES_PINNED')) return
      throw error
    }
  }
}
