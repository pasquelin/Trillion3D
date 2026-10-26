import type { PageRec } from '../selection/types.ts'
import type { GpuPageCache } from '../pages/pool/pages.ts'
import type { WebgpuDiagnosticChannel } from '../../frame/io/diagnostics.ts'
import type { WebgpuPageTracking } from '../rows/page/pageTracking.ts'
import { createDenseKeySet } from '../cut/adoption/denseKeys.ts'
import type { WebgpuResidencySets } from './sets.ts'

/** What the updater keeps: the keys waiting for their bytes, the cache of the running update, and
 *  the pins the image added and removed. */
interface Pins {
  options: PinOptions
  /** Covered keys the cache cannot pin yet: their bytes have not arrived. */
  waiting: ReturnType<typeof createDenseKeySet>
  /** The cache of the running update. */
  current: GpuPageCache
  /** What the pin sample publishes: the image's DELTA, never the pinned set. */
  added: string[]
  removed: string[]
}

const pinKey = (p: Pins, key: number) => {
  const url = p.options.tracking.pageCatalog[key]
  p.current.pin(url)
  p.waiting.remove(key)
  if (p.options.traceEnabled) p.added.push(url)
}

/** A covered key the cache has not pinned yet: pinned now when the cache holds it, else waiting
 *  for its bytes — pinned as they arrive (`takeArrivals`), never asked of the cache again. */
const want = (p: Pins, key: number) => {
  const url = p.options.tracking.pageCatalog[key]
  if (p.current.isPinned(url)) return
  if (p.current.get(url)) pinKey(p, key)
  else p.waiting.add(key)
}

/** A key leaving the cover, unpinned; a root page — its cell let go of its actor — leaves the
 *  pool with it, its root grain free for the next (`../pages/pool/placement.ts`), as the root
 *  pages of a resource let go are. */
const unpin = (p: Pins, key: number) => {
  const { current } = p
  p.waiting.remove(key)
  const url = p.options.tracking.pageCatalog[key]
  const unpinned = current.unpin(url)
  if (current.rooted(url) && current.holds(url)) current.unload(url)
  if (unpinned && p.options.traceEnabled) p.removed.push(url)
}

/** The pin sample of the image: what was added and removed, the cover and the pages shown. */
const tracePins = (p: Pins, shown: PageRec[], frame: number) => {
  const { tracking, bootstrapKey, traceDiagnostic } = p.options
  const { added, removed } = p
  traceDiagnostic('residency-pins', 'GPU pins updated', () => ({
    frame,
    added: tracking.traceSet('pins.added', added),
    removed: tracking.traceSet('pins.removed', removed),
    pinned: p.current.stats().pinned,
    bootstrap: tracking.traceSet('pins.bootstrap', coverUrls(tracking, bootstrapKey)),
    wanted: tracking.traceKeys('pins.wanted', tracking.wanted),
    shown: tracking.traceRecs('pins.shown', shown),
  }))
}

/** The cover's difference applied to `cache`'s pins, then the arrivals the keys waiting need. */
const updatePins = (
  p: Pins,
  cache: GpuPageCache,
  shown: PageRec[],
  frame: number,
  drop: (key: string) => void,
) => {
  const { tracking, sets, bootstrapKey, deferredDrops, traceEnabled } = p.options
  p.current = cache
  p.added.length = 0
  p.removed.length = 0
  const { coverEntering, coverLeaving } = sets
  for (let i = coverLeaving.count - 1; i >= 0; i--) unpin(p, coverLeaving.list[i])
  coverLeaving.clear()
  for (let i = coverEntering.count - 1; i >= 0; i--) want(p, coverEntering.list[i])
  coverEntering.clear()
  // A resize evicts pinned pages behind this path's back; a key the cover still holds waits again.
  cache.takeUnpinned((url) => {
    const key = tracking.pageCatalogIds.get(url)
    if (key !== undefined && bootstrapKey[key] > 0) want(p, key)
  })
  // The keys still waiting are pinned as their bytes arrive: each arrival is read once, never
  // the waiting keys.
  cache.takeArrivals((url) => {
    const key = tracking.pageCatalogIds.get(url)
    if (key !== undefined && p.waiting.has(key) && !cache.isPinned(url)) pinKey(p, key)
  })
  // A deferred drop is asked again, request by request — a handful —: dropped once the image
  // and the pool hold none of its clusters.
  for (const key of deferredDrops) drop(key)
  if (!traceEnabled || (!p.added.length && !p.removed.length)) return
  tracePins(p, shown, frame)
}

type PinOptions = {
  tracking: WebgpuPageTracking
  sets: WebgpuResidencySets
  /** Holders per key of the root cover: what the trace names. */
  bootstrapKey: Uint8Array
  deferredDrops: Set<string>
  traceEnabled: boolean
  traceDiagnostic: WebgpuDiagnosticChannel['traceDiagnostic']
}

/**
 * Keeps the ROOT COVER pinned — the pool's one hold: it is held apart from the pages the streaming
 * gives up, which are the oldest of its use order (`./streamedPages.ts`).
 *
 * The cover changes by a difference (`sets.coverEntering`, `sets.coverLeaving`): a key joining it is
 * pinned as soon as the cache holds its bytes, `waiting` carrying it to their arrival; a key leaving
 * it is unpinned, and unloaded when it is a root page (`unpin`). Nothing walks the pinned set per
 * image. A request whose drop waited
 * (`deferredDrops`) is asked again at each step.
 */
export function createWebgpuPinUpdater(options: PinOptions) {
  const p: Pins = {
    options,
    waiting: createDenseKeySet(),
    current: undefined as unknown as GpuPageCache,
    added: [],
    removed: [],
  }
  return (
    cache: GpuPageCache | undefined,
    shown: PageRec[],
    frame: number,
    /** Drops a request, asked again (`../../frame/io/pageApi.ts`, `dropPage`). */
    drop: (key: string) => void,
  ) => {
    if (cache) updatePins(p, cache, shown, frame, drop)
  }
}

/** The addresses of the root cover's pages, read off its holders: what a trace names. */
function coverUrls(tracking: WebgpuPageTracking, holders: Uint8Array) {
  const urls: string[] = []
  for (let key = 0; key < holders.length; key++)
    if (holders[key]) urls.push(tracking.pageCatalog[key])
  return urls
}
