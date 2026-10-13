import type { PageRec } from '../../page/selection/selection.ts'
import type { GpuPageCache } from '../../gpu/page/pages.ts'
import type { WebgpuDiagnosticChannel } from '../pages/io/diagnostics.ts'
import type { WebgpuPageTracking } from '../row/pageTracking.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import type { WebgpuResidencySets } from './sets.ts'

/**
 * Keeps the ROOT COVER pinned — the one hold the host keeps of the pool: what any view uses, and
 * when, the GPU alone knows, and its eviction order says it (`../../gpu/dag/evict.ts`).
 *
 * The cover changes by a difference (`sets.coverEntering`, `sets.coverLeaving`): a key joining it is
 * pinned as soon as the cache holds its bytes, `waiting` carrying it to their arrival; a key leaving
 * it is unpinned. A pinned page is out of the GPU's pool list, a page unpinned back in it
 * (`relist`): the GPU never lists a page the cache would refuse. Nothing walks the pinned set per
 * image. A request whose drop waited (`deferredDrops`) is asked again at each step.
 */
export function createWebgpuPinUpdater(options: {
  tracking: WebgpuPageTracking
  sets: WebgpuResidencySets
  /** Holders per key of the root cover: what the trace names. */
  bootstrapKey: Uint8Array
  deferredDrops: Set<string>
  /** The page at `address` was pinned or unpinned: the GPU's pool list follows. */
  relist: (address: string) => void
  traceEnabled: boolean
  traceDiagnostic: WebgpuDiagnosticChannel['traceDiagnostic']
}) {
  const { tracking, sets, bootstrapKey, deferredDrops, relist } = options
  const { traceEnabled, traceDiagnostic } = options
  /** Covered keys the cache cannot pin yet: their bytes have not arrived. */
  const waiting = createDenseKeySet()
  /** The cache of the running update. */
  let current: GpuPageCache
  const pinKey = (key: number) => {
    const url = tracking.pageCatalog[key]
    current.pin(url)
    waiting.remove(key)
    relist(url)
    if (traceEnabled) added.push(url)
  }
  /** A covered key the cache has not pinned yet: pinned now when the cache holds it, else waiting
   *  for its bytes — pinned as they arrive (`takeArrivals`), never asked of the cache again. */
  const want = (key: number) => {
    const url = tracking.pageCatalog[key]
    if (current.isPinned(url)) return
    if (current.get(url)) pinKey(key)
    else waiting.add(key)
  }
  const unpin = (key: number) => {
    waiting.remove(key)
    const url = tracking.pageCatalog[key]
    if (!current.unpin(url)) return
    relist(url)
    if (traceEnabled) removed.push(url)
  }
  /** What the pin sample publishes: the image's DELTA, never the pinned set. */
  const added: string[] = [],
    removed: string[] = []
  return (
    cache: GpuPageCache | undefined,
    shown: PageRec[],
    frame: number,
    /** Drops a request, asked again (`../pages/io/pageApi.ts`, `dropPage`). */
    drop: (key: string) => void,
  ) => {
    if (!cache) return
    current = cache
    added.length = 0
    removed.length = 0
    const { coverEntering, coverLeaving } = sets
    for (let i = coverLeaving.count - 1; i >= 0; i--) unpin(coverLeaving.list[i])
    coverLeaving.clear()
    for (let i = coverEntering.count - 1; i >= 0; i--) want(coverEntering.list[i])
    coverEntering.clear()
    // A resize evicts pinned pages behind this path's back; a key the cover still holds waits again.
    cache.takeUnpinned((url) => {
      const key = tracking.pageCatalogIds.get(url)
      if (key !== undefined && bootstrapKey[key] > 0) want(key)
    })
    // The keys still waiting are pinned as their bytes arrive: each arrival is read once, never
    // the waiting keys.
    cache.takeArrivals((url) => {
      const key = tracking.pageCatalogIds.get(url)
      if (key !== undefined && waiting.has(key) && !cache.isPinned(url)) pinKey(key)
    })
    // A deferred drop is asked again, request by request — a handful —: dropped once the image
    // and the pool hold none of its clusters.
    for (const key of deferredDrops) drop(key)
    if (!traceEnabled || (!added.length && !removed.length)) return
    traceDiagnostic('residency-pins', 'GPU pins updated', () => ({
      frame,
      added: tracking.traceSet('pins.added', added),
      removed: tracking.traceSet('pins.removed', removed),
      pinned: cache.stats().pinned,
      bootstrap: tracking.traceSet('pins.bootstrap', coverUrls(tracking, bootstrapKey)),
      wanted: tracking.traceKeys('pins.wanted', tracking.wanted),
      shown: tracking.traceRecs('pins.shown', shown),
    }))
  }
}

/** The addresses of the root cover's pages, read off its holders: what a trace names. */
function coverUrls(tracking: WebgpuPageTracking, holders: Uint8Array) {
  const urls: string[] = []
  for (let key = 0; key < holders.length; key++)
    if (holders[key]) urls.push(tracking.pageCatalog[key])
  return urls
}
