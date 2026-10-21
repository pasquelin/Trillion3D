import type { PageSource } from '../../../../../sdk-core/src/contracts/cache.ts'
import type { EngineDiagnostic } from '../../../diagnostic/types.ts'
import { createGpuPageReader } from './reader.ts'
import { createGpuPageLoader } from './load.ts'
import { createGpuPagePins } from './gpuPagePins.ts'
import { createPageBuffer, pageBufferBytes, type GrownPages } from './resize.ts'
import { disposePageCache, pageCacheStats, resizeBehind, unloadPage } from './cacheOps.ts'
import type { PageHomes, PageUnitsOf } from './homes.ts'
import { createEviction } from './eviction.ts'
import { createPlacement, NO_ROOT_SLOTS, type RootSlots } from './placement.ts'
import { createResidencyLog } from './residencyLog.ts'
import type { ResidentPage, GpuPageContext } from './types.ts'
/** How a GPU page cache is sized and where it reports (`createGpuPageCache`). */
export type GpuPageCacheOptions = {
  /** The bytes of one slot, the widest streaming page's: a multiple of four. */
  pageBytes: number
  /** How many slots the pool holds: a streaming page each, its root grains included. */
  slots: number
  /** Its root region, behind the streaming slots: grains for the root pages (`rootUrls`,
   *  `placement.ts`). None: the root pages take streaming slots. */
  roots?: RootSlots
  /** Every root page's address — the root cover's, and each HLOD cell's —, read live: their
   *  streaming pages take the root region's grains. None: no page is a root page. */
  rootUrls?: ReadonlySet<string>
  /** Each streaming page's width and home, taken while the pool holds the catalogue's bytes
   *  (`homes.ts`). */
  homes?: PageHomes
  /** Each address's streaming page and offset there, read live (`homes.ts`): an address it names
   *  none of is a streaming page alone. None: every page is one alone. */
  units?: PageUnitsOf
  /** The root cover's addresses: a resize keeps them before any other page. */
  cover?: ReadonlySet<string>
  /** Hears what the cache reports: its layout, cancelled loads and refusals. */
  onDiagnostic?: (d: EngineDiagnostic) => void
}

/** The GPU page cache (`createGpuPageCache`). */
export type GpuPageCache = ReturnType<typeof createGpuPageCache>

/** WebGPU allocation/queue boundary. Page bytes and policy are supplied by the host: each load
 * reads its page from `source` (`reader.ts`), which joins the reads of a page in flight and says
 * when a failed one is asked again. Queue writes are ordered; dispose waits for in-flight submits
 * before destroy. A resize keeps the pages of `cover` before any pinned page. */
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
     * Returns keys evicted for lack of room. `roots`, the new root region, keeps the one in place
     * when absent.
     */
    resize: (slots: number, grown?: GrownPages, roots?: RootSlots) =>
      resizeBehind(context, slots, grown, roots),
    get(key: string) {
      return resident.get(key)
    },
    /** `key`'s slot in words — its page's byte offset over four —, or -1 when it is not resident:
     *  what the row state reads a page's place by, on the cache, never mirrored. */
    slotWords(key: string) {
      const page = resident.get(key)
      return page ? page.offset / 4 : -1
    },
    /** How many pages are resident now. */
    get residentPages() {
      return resident.size
    },
    get residencyRevision() {
      return state.generation + state.evictions
    },
    /** Each key that arrived since the last call, told once, in order (`residencyLog.ts`). */
    takeArrivals: (visit: (key: string) => void) => context.changes.takeArrivals(visit),
    /** Each pinned page that left since the last call, its pin with it, told once. */
    takeUnpinned: (visit: (key: string) => void) => context.changes.takeUnpinned(visit),
    /** Each key that left since the last call, told once, in order, whatever took it: a victim, a
     *  resize, an unload (`residencyLog.ts`). */
    takeDepartures: (visit: (key: string) => void) => context.changes.takeDepartures(visit),
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
  const { pageBytes, slots, homes, units } = options
  const roots = options.roots ?? NO_ROOT_SLOTS,
    cover = options.cover ?? new Set<string>(),
    rootUrls = options.rootUrls ?? new Set<string>()
  const allocatedBytes = pageBufferBytes(device, pageBytes, slots, homes, roots)
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
    rootSlots: roots.slots,
    rootBytes: roots.bytes,
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
  const resident = new Map<string, ResidentPage>()
  const eviction = createEviction(resident)
  const placement = createPlacement({
    bytes: allocatedBytes,
    widest: pageBytes,
    ...{ homes, units, roots, rootUrls, resident },
  })
  const context: GpuPageContext = {
    device,
    pageBytes,
    slots,
    roots,
    homes,
    units,
    buffer,
    resident,
    cover,
    rootUrls,
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
