import type { PageRec } from '../../page/selection/selection.ts'
import type { createGpuPageCache } from '../../gpu/page/pages.ts'
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import type { WebgpuResidencySets } from './sets.ts'
import { createLastUse } from '../../residency/lastUse.ts'
import { LAST_USE_WINDOW } from './lastUseWindow.ts'

type Cache = ReturnType<typeof createGpuPageCache>
type Trace = ReturnType<typeof createWebgpuDiagnostics>['traceDiagnostic']
type Tracking = ReturnType<typeof createWebgpuPageTracking>

/**
 * Keeps the complete root cover and current cut pinned while admitting new detail.
 *
 * The kept set changed by a difference, so the pins follow that difference: the keys that joined
 * are pinned as soon as the cache holds their bytes, and `waiting` carries the ones still in flight
 * to the next image. The keys that left are unpinned by last use (`../../residency/lastUse.ts`):
 * once unused for its window, oldest first, and never while a held page depends on them. Nothing
 * walks the pinned set per image.
 */
export function createWebgpuPinUpdater(options: {
  tracking: Tracking
  sets: WebgpuResidencySets
  /** Holders per key of the root cover: a page it holds is pinned in the held tier. */
  bootstrapKey: Uint8Array
  deferredDrops: Set<string>
  /** Clusters each request carries: a deferred drop names the request, not the cluster. */
  byUrl: Map<string, PageRec[]>
  /** The pages a page depends on (`admission.ts`): they leave after it. */
  parentsOf: (rec: PageRec) => readonly PageRec[]
  traceEnabled: boolean
  traceDiagnostic: Trace
}) {
  const { tracking, sets, bootstrapKey, deferredDrops, byUrl } = options
  const { traceEnabled, traceDiagnostic } = options
  /** Kept keys the cache cannot pin yet: their bytes have not arrived. */
  const waiting = createDenseKeySet()
  /** The waiting keys the image keeps: what it still misses, the window's pressure. */
  const waitingKept = createDenseKeySet()
  /** A held key the cache has not pinned yet: pinned now when the cache holds it, else waiting for
   *  its bytes — pinned as they arrive (`takeArrivals`), never asked of the cache again. */
  const want = (key: number) => {
    if (tracking.pinned.has(key)) return
    if (current?.get(tracking.pageCatalog[key])) pinKey(key)
    else {
      waiting.add(key)
      if (tracking.keep.has(key)) waitingKept.add(key)
    }
  }
  const pinKey = (key: number) => {
    const url = tracking.pageCatalog[key]
    // A root-cover page evicted by a resize comes back in the held tier it had.
    current.pin(url, bootstrapKey[key] > 0 ? 'held' : 'pinned')
    tracking.markPinned(key)
    waiting.remove(key)
    waitingKept.remove(key)
    if (traceEnabled) added.push(url)
  }
  const lastUse = createLastUse({
    idleWindow: LAST_USE_WINDOW,
    keyOf: tracking.keyOf,
    parentsOf: options.parentsOf,
    kept: tracking.keep.has,
    onHeld: want,
    onIdle: (key) => current.touch(tracking.pageCatalog[key]),
  })
  /** The cache of the running update, read by the callbacks built once above and below. */
  let current: Cache
  /** True when the key held a slot pinned: unpinning it gives that slot back. */
  const unpin = (key: number) => {
    waiting.remove(key)
    waitingKept.remove(key)
    if (!tracking.pinned.remove(key)) return false
    const url = tracking.pageCatalog[key]
    if (traceEnabled) removed.push(url)
    current.unpin(url)
    return true
  }
  /**
   * What the pin sample publishes: the image's DELTA, never the pinned set. Copying and filtering
   * it cost four walks of the cut per image as soon as trace was requested, while pins change by a
   * handful of keys.
   */
  const added: string[] = [],
    removed: string[] = []
  return (
    cache: Cache | undefined,
    shown: PageRec[],
    frame: number,
    drop: (key: string) => void,
  ) => {
    if (!cache) return
    current = cache
    added.length = 0
    removed.length = 0
    const { entering, enteringPages, leaving } = sets
    for (let i = leaving.count - 1; i >= 0; i--) {
      waitingKept.remove(leaving.list[i])
      lastUse.leave(leaving.list[i], frame)
    }
    leaving.clear()
    for (let i = entering.count - 1; i >= 0; i--) {
      const key = entering.list[i]
      lastUse.use(key, enteringPages[i])
      want(key)
    }
    entering.clear()
    // A host page drop unpins behind this path's back; a key it still keeps goes back in the queue.
    const notices = tracking.unpinned
    for (let i = 0; i < notices.length; i++) {
      const key = notices[i]
      if (lastUse.holds(key)) want(key)
    }
    notices.length = 0
    // The keys still waiting are pinned as their bytes arrive: each arrival is read once, never
    // the waiting keys, which a pool its pins fill could keep by the hundred thousand.
    cache.takeArrivals((url) => {
      const key = tracking.pageCatalogIds.get(url)
      if (key !== undefined && waiting.has(key) && !tracking.pinned.has(key)) pinKey(key)
    })
    // What the image keeps and still misses is the pressure the window gives way to.
    const missing = waitingKept.count
    // Released oldest first, each where it went when it went idle: the cache then reclaims the
    // released pages in their last-use order. What the image still misses beyond the unpinned
    // slots is the pressure: the window gives way to it (`../../residency/lastUse.ts`).
    lastUse.release(frame, unpin, missing - cache.unpinnedSlots())
    // Kept keys are clusters; a deferred drop names the request that carries them. The question is
    // therefore asked request by request — a handful — and not by copying the kept set into two
    // string tables on every image where a drop waits, which the cluster count of a city makes
    // impractical: the catalogue already says which clusters a request carries.
    for (const key of deferredDrops) {
      const recs = byUrl.get(key)
      let kept = false
      if (recs)
        for (let i = 0; i < recs.length && !kept; i++) kept = lastUse.holds(tracking.keyOf(recs[i]))
      if (!kept) drop(key)
    }
    if (!traceEnabled || (!added.length && !removed.length)) return
    traceDiagnostic('residency-pins', 'GPU pins updated', () => ({
      frame,
      added: tracking.traceSet('pins.added', added),
      removed: tracking.traceSet('pins.removed', removed),
      pinned: tracking.traceKeys('pins', tracking.pinned),
      bootstrap: tracking.traceSet('pins.bootstrap', coverUrls(tracking, bootstrapKey)),
      wanted: tracking.traceKeys('pins.wanted', tracking.wanted),
      shown: tracking.traceRecs('pins.shown', shown),
    }))
  }
}

/** The addresses of the root cover's pages, read off its holders: what a trace names. */
function coverUrls(tracking: Tracking, holders: Uint8Array) {
  const urls: string[] = []
  for (let key = 0; key < holders.length; key++)
    if (holders[key]) urls.push(tracking.pageCatalog[key])
  return urls
}
