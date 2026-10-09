import type { PageSource } from '../../../../sdk-core/src/index.ts'
import type { EngineDiagnostic } from '../../engine/types.ts'
import { createGpuPageReader } from './reader.ts'
import { createGpuPageLoader } from './load.ts'
import { createGpuPagePins } from './gpuPagePins.ts'
import { createPageBuffer, pageBufferBytes } from './resize.ts'
import { disposePageCache, pageCacheStats, resizeBehind, unloadPage } from './cacheOps.ts'
import { heldHomes, type PageHomes } from './homes.ts'
import { createEviction, type EvictionOrder } from './eviction.ts'
import { homePlacement, slotPlacement } from './placement.ts'
import { createResidencyLog } from './residencyLog.ts'
import { createPageStreamer } from '../../streaming/pageStreamer.ts'
import { createPageCache } from '../../streaming/pageCache.ts'
import type { ResidentPage, GpuPageContext } from './types.ts'
export type { ResidentPage } from './types.ts'
/** How a GPU page cache is sized and where it reports (`createGpuPageCache`). */
export type GpuPageCacheOptions = {
  /** The bytes of one slot: a multiple of four. */
  pageBytes: number
  /** How many slots the pool holds. */
  slots: number
  /** Each page's own place, taken while `slots` hold the whole catalogue (`homes.ts`). */
  homes?: PageHomes
  /** Hears what the cache reports: its layout, cancelled loads and refusals. */
  onDiagnostic?: (d: EngineDiagnostic) => void
}

/** WebGPU allocation/queue boundary. Page bytes and policy are supplied by the host: each load
 * reads its page from `source` (`reader.ts`), which joins the reads of a page in flight and says
 * when a failed one is asked again. Queue writes are ordered; dispose waits for in-flight submits
 * before destroy. `pin(key, 'held')` keeps a page ahead of ordinary pins during `resize(slots)`,
 * which no longer accepts a held set. Ordinary repinning preserves the held tier; `unpin(key)`
 * removes it. */
export function createGpuPageCache(
  device: GPUDevice,
  source: PageSource,
  options: GpuPageCacheOptions,
) {
  const { pageBytes } = options
  if (!Number.isSafeInteger(pageBytes) || pageBytes < 4 || pageBytes % 4)
    throw new Error('INVALID_PAGE_BUDGET')
  const context = pageContext(device, source, options)
  const pinning = createGpuPagePins(context)
  const load = createGpuPageLoader(context, pinning.pin)
  const { resident, state } = context
  return {
    /** The pool buffer: a new identity after `resize`, to be rebound. */
    get buffer() {
      return context.buffer
    },
    load,
    /**
     * Changes the pool size while keeping its pages, behind in-flight loads: nothing is written
     * into a buffer while it is being copied. The cache keeps held pins before ordinary pins.
     * Returns keys evicted for lack of room.
     */
    resize: (slots: number) => resizeBehind(context, slots),
    get(key: string) {
      return resident.get(key)
    },
    /** Evicts in `order` from now on: an arrival takes the slot of its first resident, unpinned page
     *  not taken yet, never of a page it leaves out. `undefined` goes back to the least recent. */
    evictInOrder: (order?: EvictionOrder) => context.eviction.follow(order),
    /** Membership changes increase this counter; LRU touches do not. Callers with a verdict from
     * `get` can compare it instead of querying every page again. */
    get residencyRevision() {
      return state.generation + state.evictions
    },
    /** Moves the pending residency changes into the caller's arrays, then empties the log: one
     *  entry a key, its last place (`residencyLog.ts`). */
    drainResidencyChanges: (keys: string[], slots: number[]) => context.changes.drain(keys, slots),
    ...pinning,
    unload: (key: string) => unloadPage(context, key),
    stats: () => pageCacheStats(context),
    dispose: () => disposePageCache(context),
  }
}

/** The pool's buffer, its bookkeeping and its reader, the catalogue announced. */
function pageContext(device: GPUDevice, source: PageSource, options: GpuPageCacheOptions) {
  const { pageBytes, slots, homes } = options
  const allocatedBytes = pageBufferBytes(device, pageBytes, slots, homes)
  const buffer = createPageBuffer(device, allocatedBytes)
  const state = {
    pending: Promise.resolve() as Promise<unknown>,
    disposed: false,
    loading: 0,
    generation: 0,
    bytesRead: 0,
    uploadedBytes: 0,
    evictions: 0,
  }
  const reader = createGpuPageReader(source, pageBytes, options.onDiagnostic)
  const { emit } = reader
  emit?.('gpu-page-catalogue', 'GPU cache configured', () => ({
    version: 1,
    pageBytes,
    slots,
    allocatedBytes,
    source: 'host-page-source',
    drawDetached: false,
  }))
  const check = (signal?: AbortSignal) => {
    if (state.disposed) {
      emit?.('gpu-page-error', 'Operation refused after dispose', () => ({
        version: 1,
        error: 'PAGE_CACHE_DISPOSED',
      }))
      throw new Error('PAGE_CACHE_DISPOSED')
    }
    signal?.throwIfAborted()
  }
  const resident = new Map<string, ResidentPage>(),
    pins = new Set<string>()
  const ownHomes = heldHomes(homes, slots)
  const eviction = createEviction(resident, pins)
  const placement = ownHomes
    ? homePlacement(ownHomes, ownHomes.homes.size)
    : slotPlacement(
        pageBytes,
        Array.from({ length: slots }, (_, slot) => slot),
        eviction,
      )
  const context: GpuPageContext = {
    device,
    pageBytes,
    slots,
    homes,
    buffer,
    resident,
    pins,
    held: new Set<string>(),
    abort: new AbortController(),
    state,
    eviction,
    placement,
    changes: createResidencyLog(),
    reader,
    check,
  }
  return context
}
/** A page source that fetches pages over HTTP, by key, from `baseUrl`, through a page streamer of
 *  its own over a page cache of its own (`streaming/pageStreamer.ts`): each key read joins its one
 *  job, so two loads of one page in flight send one request, and a page whose read failed waits its
 *  turn by the one failure policy, its loads waiting on it — or is refused for good when another
 *  request would meet its failure again (`streaming/failures.ts`). It announces nothing of a page:
 *  its bytes are taken as the server sends them, and kept by the loads alone. A key is catalogued
 *  by its first read. `dispose` cancels its reads and empties its cache. */
export function httpPageSource(baseUrl: string): PageSource & { dispose(): void } {
  const cache = createPageCache()
  const streamer = createPageStreamer([], baseUrl, { cache })
  return {
    read(key, signal, priority) {
      if (!streamer.catalogued(key)) streamer.admit([{ url: key, bytes: 0, kept: false }])
      return streamer.readBytes(key, signal ?? streamer.signal, priority)
    },
    dispose() {
      streamer.dispose()
      cache.clear()
    },
  }
}
