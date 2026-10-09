import type { PageSource } from '../../../../sdk-core/src/index.ts'
import type { EngineDiagnostic } from '../../engine/types.ts'
import { createGpuPageReader } from './reader.ts'
import { createGpuPageLoader } from './load.ts'
import { createGpuPagePins } from './gpuPagePins.ts'
import { createPageBuffer, pageBufferBytes } from './resize.ts'
import { disposePageCache, pageCacheStats, resizeBehind, unloadPage } from './cacheOps.ts'
import { heldHomes, type PageHomes } from './homes.ts'
import { createEviction, type EvictionOrder } from './eviction.ts'
import { homePlacement, slotPlacement, wholeSlots } from './placement.ts'
import { createResidencyLog } from './residencyLog.ts'
import { createReadFailures } from '../../streaming/failures.ts'
import { checked, ONE_REQUEST, retriableError } from '../../cluster/checked.ts'
import { waited, waitShared, type SharedRead } from '../../../../sdk-core/src/runtime/sharedRead.ts'
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
    /** Each key that arrived since the last call, told once, in order (`residencyLog.ts`). */
    takeArrivals: (visit: (key: string) => void) => context.changes.takeArrivals(visit),
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
        wholeSlots(Array.from({ length: slots }, (_, slot) => slot)),
        eviction,
        resident,
        pins,
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
/** An HTTP page source's read of one key, joined by every load of it while it runs, and what
 *  stops it once none waits on it. */
type HttpRead = SharedRead<Uint8Array> & { stop: AbortController }

/** A page source that fetches pages over HTTP, by key, from `baseUrl`: each key read is one read
 *  every load of it joins while it runs, so two loads of one page in flight send one request, and
 *  the read stops once no load waits on it. A read that fails waits its turn by the one failure
 *  policy, its loads waiting on it, then asks again — or is refused for good when another request
 *  would meet its failure again, every later load of its key refused at once
 *  (`streaming/failures.ts`). It announces nothing of a page: its bytes are taken as the server
 *  sends them, and kept by the loads alone; a read is forgotten as it ends, its key's failure as
 *  the policy forgets it. Its requests are sent as they are asked: it has no queue, and `priority`
 *  orders nothing. `dispose` stops its reads. */
export function httpPageSource(baseUrl: string): PageSource & { dispose(): void } {
  const life = new AbortController()
  const reads = new Map<string, HttpRead>()
  /** What resumes each read waiting its turn after a failure. */
  const resumes = new Map<string, () => void>()
  const failures = createReadFailures({
    retriable: retriableError,
    ended: (key) => resumes.get(key)?.(),
  })
  /** The end of `key`'s wait after its failure, or `signal`'s stop. */
  const turn = (key: string, signal: AbortSignal) =>
    waited(new Promise<void>((resume) => resumes.set(key, resume)), signal).finally(() =>
      resumes.delete(key),
    )
  /** `key`'s bytes, asked again after each failure that may pass once its wait ended. */
  const fetchKey = async (key: string, signal: AbortSignal) => {
    const url = new URL(key, baseUrl).href
    for (;;) {
      const blocked = failures.blocked(key)
      if (blocked?.state === 'refused') throw blocked.error
      if (blocked) await turn(key, signal)
      try {
        const response = await checked(url, signal, ONE_REQUEST)
        const bytes = new Uint8Array(await response.arrayBuffer())
        failures.passed(key)
        return bytes
      } catch (cause) {
        if (signal.aborted) throw cause
        const { error, waits } = failures.record(key, cause)
        if (!waits) throw error
      }
    }
  }
  /** `read` leaves the reads of `key`, if it is still its read. */
  const forget = (key: string, read: HttpRead) =>
    void (reads.get(key) === read && reads.delete(key))
  /** `key`'s read, started: forgotten as it ends. */
  const start = (key: string) => {
    const stop = new AbortController()
    const read: HttpRead = { promise: fetchKey(key, stop.signal), askers: 0, stop }
    reads.set(key, read)
    const ended = () => forget(key, read)
    read.promise.then(ended, ended)
    return read
  }
  return {
    read(key, signal = life.signal) {
      if (life.signal.aborted) return Promise.reject(life.signal.reason)
      const read = reads.get(key) ?? start(key)
      // The last load to leave stops the read: a load of its key asked after starts another.
      return waitShared(read, signal, () => {
        forget(key, read)
        read.stop.abort(signal.reason)
      })
    },
    dispose() {
      life.abort(new DOMException('Page source disposed', 'AbortError'))
      for (const read of reads.values()) read.stop.abort(life.signal.reason)
      reads.clear()
      failures.clear()
    },
  }
}
