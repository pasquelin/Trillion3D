import type { PageSource } from '../../../../sdk-core/src/index.ts'
import type { EngineDiagnostic } from '../../engine/types.ts'
import { createGpuPageReader } from './reader.ts'
import { createGpuPageLoader } from './load.ts'
import { createGpuPagePins } from './gpuPagePins.ts'
import { createPageBuffer, pageBufferBytes } from './resize.ts'
import {
  disposePageCache,
  drainResidencyChanges,
  pageCacheStats,
  resizeBehind,
  unloadPage,
} from './cacheOps.ts'
import { heldHomes, type PageHomes } from './homes.ts'
import { checked, ONE_REQUEST } from '../../cluster/checked.ts'
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

/** WebGPU allocation/queue boundary. Page bytes and policy are supplied by the host. Queue writes
 * are ordered; dispose waits for in-flight submits before destroy. `pin(key, 'held')` keeps a page
 * ahead of ordinary pins during `resize(slots)`, which no longer accepts a held set. Ordinary
 * repinning preserves the held tier; `unpin(key)` removes it. */
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
    evictInOrder(order?: { readonly count: number; keyAt(at: number): string }) {
      Object.assign(context.eviction, { order, at: 0, lateAt: 0 })
      context.eviction.epoch++
      context.eviction.held.length = context.eviction.late.length = 0
    },
    /** Membership changes increase this counter; LRU touches do not. Callers with a verdict from
     * `get` can compare it instead of querying every page again. */
    get residencyRevision() {
      return state.generation + state.evictions
    },
    /** Moves the pending residency changes into the caller's arrays, then empties the log. */
    drainResidencyChanges: (keys: string[], slots: number[]) =>
      drainResidencyChanges(context, keys, slots),
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
    generation: 0,
    bytesRead: 0,
    uploadedBytes: 0,
    evictions: 0,
  }
  const fetches = new Map<string, Promise<Uint8Array>>()
  const reader = createGpuPageReader(source, pageBytes, options.onDiagnostic, fetches)
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
  const context: GpuPageContext = {
    device,
    pageBytes,
    slots,
    homes,
    buffer,
    resident: new Map<string, ResidentPage>(),
    pins: new Set<string>(),
    held: new Set<string>(),
    free: Array.from({ length: heldHomes(homes, slots)?.homes.size ?? slots }, (_, i) => i),
    abort: new AbortController(),
    fetches,
    state,
    eviction: { at: 0, epoch: 0, lower: new Map(), held: [], late: [], lateAt: 0 },
    // Every arrival and departure in order, so a host mirrors the cache page by page instead of
    // asking for all of its catalogue every frame. `changeSlots[i]` is the slot's words offset,
    // or -1.
    changeKeys: [],
    changeSlots: [],
    reader,
    check,
  }
  return context
}
/** A page source that fetches pages over HTTP, by key, from `baseUrl`. */
export function httpPageSource(baseUrl: string): PageSource {
  return {
    async read(key, signal) {
      const response = await checked(new URL(key, baseUrl).href, signal, ONE_REQUEST)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
