import type { PageRec } from '../../page/selection/types.ts'
import { createSparseInts } from '../../page/cut/sparseInts.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts'
import type { GpuPageCache } from '../../gpu/page/pages.ts'
import { pageAddress } from '../row/pageSlots.ts'
import type { WebgpuPageTracking } from '../row/pageTracking.ts'
import type { createAdmissionReads, createPageAdmission } from './admission.ts'
import { admitInOrder, type AdmitStep } from './ensureBurst.ts'

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
    /** Advanced by every report: the copy a job walks is remade only then (`createLowerCopy`). */
    get revision() {
      return revision
    },
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

/** A tier as the residency ensurer reads it: its pages, and a revision each report advances. */
export type LowerList = {
  pages: readonly PageRec[]
  revision: number
}

/**
 * The tier's pages as one job walks them: a copy, as its last report left them. The tier's list is
 * rewritten in place by every report taken while a job loads, and a loop resumed on another list
 * keeps neither its order nor its count of free slots. Made anew only when the tier reported since:
 * the jobs that follow one another between two reports read it as it is, and a job still walking
 * the one before — a capture's `ensureResident` runs beside the queue — keeps it whole.
 */
function createLowerCopy(tier: () => LowerList) {
  let list: readonly PageRec[] = [],
    seen: LowerList | undefined,
    revision = -1
  return (): readonly PageRec[] => {
    const now = tier()
    if (now === seen && now.revision === revision) return list
    seen = now
    revision = now.revision
    list = now.pages.slice()
    return list
  }
}

export type LowerPassOptions = {
  getCache: () => GpuPageCache | undefined
  tracking: Pick<WebgpuPageTracking, 'keyOf' | 'wanted'>
  bootstrapKey: Uint8Array
  signal?: AbortSignal
  hasBytes: (page: PageRec) => boolean
  isLost: () => boolean
  /** The lower tier: the pages ahead of the camera (`createLowerTier`). */
  lowerTier: () => LowerList
  admit: ReturnType<typeof createPageAdmission>
  budget: FrameClock
  /** The share step (`share.ts`): the next share to await once the clock's share is spent. */
  share: () => Promise<void> | undefined
  readAhead: ReturnType<typeof createAdmissionReads> | undefined
}
type LowerPass = LowerPassOptions & { skips: (rec: PageRec) => boolean }

/** The lower tier's pass of the residency ensurer (`residentEnsurer.ts`): its list as a job walks
 *  it, its load into what the camera left, and whether it leaves work. */
export function createLowerPass(options: LowerPassOptions) {
  const { tracking, bootstrapKey, hasBytes, lowerTier } = options
  const listed = createLowerCopy(lowerTier)
  /** Whether a lower tier page is not the tier's to load: wanted by the camera, pinned, or without
   *  its bytes. */
  const skips = (rec: PageRec) => {
    const key = tracking.keyOf(rec)
    return tracking.wanted.has(key) || !!bootstrapKey[key] || !hasBytes(rec)
  }
  const pass: LowerPass = { ...options, skips }
  return {
    list: listed,
    load: (
      lower: readonly PageRec[],
      cache: GpuPageCache,
      cameraWaiting: () => boolean,
      reads: AbortSignal,
    ) => loadLowerTier(pass, lower, cache, cameraWaiting, reads),
    /** True when every lower tier page is held, or left to the camera: the tier leaves no work. */
    held: (cache: GpuPageCache) =>
      listed().every((rec) => skips(rec) || !!cache.get(pageAddress(rec))),
  }
}

/**
 * What the camera left: the lower tier's pages — the pages ahead of the camera —, loaded only into
 * the free slots and those of the OLD pages the GPU's order gives up — older than any page the view
 * ahead asks for (`../../gpu/page/eviction.ts`), through the one admission loop (`admitInOrder`).
 * They are never pinned: a camera page evicts them, they never evict a page any view used of late,
 * and an object on screen is never coarsened for a view to come. The view ahead stamps every page
 * its list still names (`stampAhead`), so a wanted page is never evicted and reloaded each frame
 * (#1016). Past a share the job leaves if a camera cut asked for pages meanwhile: the queue serves
 * the camera first and runs the tier again. A job only ends on a tier pass nobody interrupted, so
 * every wait on it finds the tier posted (#281). The camera's own burst taking the last slot
 * meanwhile (`POOL_FULL`) leaves the tier waiting, as it does.
 */
async function loadLowerTier(
  pass: LowerPass,
  lower: readonly PageRec[],
  cache: GpuPageCache,
  cameraWaiting: () => boolean,
  reads: AbortSignal,
) {
  const { skips, signal } = pass
  let spare = cache.room(true)
  pass.readAhead?.(lower, spare, (rec) => !skips(rec), cache, reads, PRIORITY_PREFETCH)
  const before = (rec: PageRec): AdmitStep => {
    if (spare <= 0) return 'leave'
    if (skips(rec) || cache.get(pageAddress(rec))) return 'skip'
    signal?.throwIfAborted()
    return pass.isLost() || pass.getCache() !== cache ? 'leave' : 'admit'
  }
  await admitInOrder(pass, lower, {
    before,
    resumed: (rec) => (cameraWaiting() ? 'leave' : before(rec)),
    admitted: (taken) => (spare -= Math.max(0, taken)),
    priority: PRIORITY_PREFETCH,
  })
}
