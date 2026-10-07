import { createStreamingFetcher } from './fetch.ts'
import { createStreamingQueue } from './queue.ts'
import type { StreamContext, Job, StreamPage, BatchRead, PageStreamerOptions } from './types.ts'
import { createTransferQueue } from './queueRanges.ts'
import { createReadFailures } from './failures.ts'
import { createStreamingCache } from './cache.ts'
import { createIndexViews } from './indexView.ts'
import { createPageCache, type PageCache } from './pageCache.ts'
import { manifestTableBytes } from './manifestTables.ts'
import { createReadWatch } from './readWatch.ts'
import { lazyDiagnostic } from '../diagnostic/engineDiagnostic.ts'
/** Bounded, prioritized and deduplicated reads. A request still waiting in the queue is dropped once
 *  its last consumer leaves; one already transferring is allowed to land in the cache.
 *  The cache is a least-recently-used set bounded by both entries and bytes; pinned entries survive
 *  eviction, so a caller keeps its displayed cover by retaining it. */
export const createPageStreamer = (
  pages: readonly StreamPage[],
  base: string,
  options?: PageStreamerOptions,
) => createPageStreamerWith(pages, base, options)
/** `createPageStreamer` reading through `options.cache`, a world's kept cache (`pageCache.ts`). */
export function createPageStreamerWith(
  pages: readonly StreamPage[],
  base: string,
  options: PageStreamerOptions & { cache?: PageCache } = {},
) {
  const { cache: kept, signal, maxPages, onEvict, onDiagnostic, maxCachedBytes } = options
  const { workerCount = 8, maxTransferBytes = 8 * 1024 * 1024 } = options
  const catalog = new Map(pages.map((page) => [page.url, page]))
  const store = kept ?? createPageCache(maxCachedBytes),
    cache = store.pages,
    jobs = new Map<string, Job>(),
    queue = createTransferQueue()
  const pinned = new Set<string>(),
    abort = new AbortController()
  // A job whose failure's wait ended is queued again by the queue below, made once this is.
  const failures = createReadFailures({ jobs, catalog, onStalled: options.onStalled }, (job) =>
    reads.requeue(job),
  )
  if (signal) {
    if (signal.aborted) abort.abort(signal.reason)
    else signal.addEventListener('abort', () => abort.abort(signal.reason), { once: true })
  }
  // Closed, every job ends at once, its askers told: one listener, whatever the jobs.
  abort.signal.addEventListener(
    'abort',
    () => {
      for (const job of jobs.values()) job.reject(abort.signal.reason)
    },
    { once: true },
  )
  const limit = Number.isSafeInteger(workerCount) ? Math.max(1, workerCount) : 1
  if (!Number.isSafeInteger(maxTransferBytes) || maxTransferBytes < 1)
    throw new Error('INVALID_PAGE_TRANSFER_BUDGET')
  const state = {
    tableBytes: manifestTableBytes(pages),
    order: 0,
    active: 0,
    activeBytes: 0,
    requested: 0,
    hits: 0,
    misses: 0,
    bytesRead: 0,
    loaded: 0,
    evictions: 0,
    admissionBlocked: 0,
    disposed: false,
    reservedBytes: () => 0,
  }
  const emit = lazyDiagnostic(onDiagnostic)
  const abortError = () => new DOMException('Page request cancelled', 'AbortError')
  const context: StreamContext = {
    ...{ base, catalog, store, cache, jobs, queue, pinned, failures, abort, limit, maxPages },
    ...{ maxTransferBytes, onEvict, onDiagnostic, state, emit, abortError },
  }
  const { read: transfer, roundTrip, keptBytes } = createStreamingFetcher(context, store.touch)
  const reserved = () => state.tableBytes + maxTransferBytes + state.reservedBytes() + keptBytes()
  const streaming = createStreamingCache(context, reserved)
  const { touch, evict, sync, retain, retainRanks, reserve } = streaming
  // A kept page held under a page's name as another file leaves before its first read.
  store.dropForeign(pages)
  const release = store.hold(streaming.holder)
  if (kept) evict()
  else store.resize(store.cpuBytes + store.reservedBytes)
  emit?.('page-catalogue', 'Streamer catalogue and configuration ready', () => ({
    version: 1,
    pages: catalog.size,
    workerCount: limit,
    maxPages: maxPages ?? null,
    maxTransferBytes,
    maxCachedBytes: store.budgetBytes,
    cpuBudgetBytes: store.cpuBytes,
    totalBytes: pages.reduce((sum, page) => sum + page.bytes, 0),
  }))
  const reads = createStreamingQueue(context, transfer, touch, evict, sync)
  const { forget, keep } = reads
  const { read, watch } = createReadWatch(reads.subscribe)
  const asIndices = createIndexViews()
  const readBytes = (url: string, signal?: AbortSignal, priority = 0) => {
    state.requested++
    return read(url, signal, priority)
  }
  return {
    admit(more: readonly StreamPage[]) {
      store.dropForeign(more)
      for (const page of more) {
        keep(page.url)
        if (!catalog.has(page.url)) state.tableBytes += manifestTableBytes([page])
        catalog.set(page.url, page)
      }
    },
    // A page a read holds, queued or in transfer, stays catalogued until that read settles.
    forget: (urls: readonly string[]) => urls.forEach(forget),
    get(url: string) {
      const array = cache.get(url)
      if (array) touch(url, array)
      return array ? asIndices(array) : undefined
    },
    getBytes(url: string) {
      const array = cache.get(url)
      if (array) touch(url, array)
      return array
    },
    has: (url: string) => cache.has(url),
    loading: (url: string) => jobs.has(url),
    /** Whether a read of `url` is refused for good: another request would meet its failure again.
     *  One that may pass is never refused: it waits its turn, its askers waiting on it. */
    failed: (url: string) => failures.refusal(url) !== undefined,
    /** The reads' measured round trip in milliseconds, 0 before the first (`roundTrip.ts`). */
    roundTripMs: roundTrip.ms,
    read: (url: string, signal?: AbortSignal) => readBytes(url, signal).then(asIndices),
    readBytes,
    /** Texture levels held beside the pages: its world's, kept across a device loss, or its own. */
    textureLevels: store.levels,
    retain,
    reserve,
    /** Pins by rank delta: neither an address list nor a set rebuilt each frame. */
    retainRanks,
    /** Hears every page read, whoever asks it, until the returned stop runs (`readWatch.ts`). */
    watch,
    /** Reads `urls` the catalog holds, once each, each landing handed to `onPage` at once; it
     *  settles once every read and `onPage` has, rejecting with the first failure in `urls` order. */
    async request(urls: readonly string[], options: BatchRead = {}) {
      const unique = [...new Set(urls.filter((url) => catalog.has(url)))]
      state.requested += unique.length
      emit?.('page-request-batch', 'Batched page request received', () => ({
        version: 1,
        requested: urls.length,
        unique: unique.length,
      }))
      const { signal, priority = 1, onPage } = options
      const landed = await Promise.allSettled(
        unique.map((url) => read(url, signal, priority).then(() => onPage?.(url))),
      )
      for (const page of landed) if (page.status === 'rejected') throw page.reason
    },
    stats() {
      return {
        requested: state.requested,
        loaded: state.loaded,
        hits: state.hits,
        misses: state.misses,
        bytesRead: state.bytesRead,
        loading: state.active,
        queued: queue.size,
        transferInFlightBytes: state.activeBytes,
        resident: cache.size,
        residentBytes: store.bytes,
        maxCachedBytes: store.budgetBytes,
        /** CPU bytes held (manifest tables, transfers, pages, kept file, levels) of the total. */
        cpuBytes:
          state.tableBytes + state.activeBytes + store.bytes + store.besideBytes + keptBytes(),
        cpuBudgetBytes: store.cpuBytes,
        evictions: state.evictions,
        /** Reads that failed and do not pass now: waiting their turn, or refused for good. */
        failed: failures.count(),
        admissionBlocked: state.admissionBlocked,
      }
    },
    dispose() {
      if (state.disposed) return
      state.disposed = true
      emit?.('page-stream-dispose', 'Page streamer released', () => ({
        version: 1,
        resident: cache.size,
        loading: state.active,
        failed: failures.count(),
      }))
      abort.abort(abortError())
      for (const job of jobs.values()) job.stop.abort(abortError())
      jobs.clear()
      queue.clear()
      release()
      // A kept cache is its owner's, for the next session; one of the streamer's own leaves now.
      if (!kept) store.clear()
      pinned.clear()
      failures.clear()
    },
  }
}
