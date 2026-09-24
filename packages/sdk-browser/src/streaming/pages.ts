import { createStreamingFetcher } from './fetch.ts';
import { createStreamingQueue } from './queue.ts';
import type { BackendDiagnostic } from '../backend/types.ts';

import type { StreamContext, Job, StreamPage } from './types.ts';
import { createStreamingCache } from './cache.ts';
import { createPageCache, manifestTableBytes, type PageCache } from './pageCache.ts';
export type { StreamPage } from './types.ts';
/** Bounded, prioritized and deduplicated reads. A request still waiting in the queue is dropped once
 *  its last consumer leaves; one already transferring is allowed to land in the cache.
 *  The cache is a least-recently-used set bounded by both entries and bytes; pinned entries survive
 *  eviction, so a caller keeps its displayed cover by retaining it. The cache is `kept` when the
 *  caller hands one in (`pageCache.ts`): the streamer then reserves its manifest tables and its
 *  transfer queue off the cache's CPU total, drops what the catalogue no longer names at that size,
 *  and leaves the pages there when it is disposed, for the next session. */
export function createPageStreamer(
  pages: readonly StreamPage[],
  base: string,
  signal?: AbortSignal,
  workerCount = 8,
  maxPages?: number,
  onEvict?: (url: string) => void,
  maxTransferBytes = 8 * 1024 * 1024,
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void,
  kept?: PageCache,
) {
  const catalog = new Map(pages.map((page) => [page.url, page]));
  const store = kept ?? createPageCache(),
    cache = store.pages,
    jobs = new Map<string, Job>(),
    queue: Job[] = [];
  const pinned = new Set<string>(),
    failures = new Map<string, Error>(),
    abort = new AbortController();
  if (signal) {
    if (signal.aborted) abort.abort(signal.reason);
    else signal.addEventListener('abort', () => abort.abort(signal.reason), { once: true });
  }
  const limit = Number.isSafeInteger(workerCount) ? Math.max(1, workerCount) : 1;
  if (!Number.isSafeInteger(maxTransferBytes) || maxTransferBytes < 1)
    throw new Error('INVALID_PAGE_TRANSFER_BUDGET');
  const tableBytes = manifestTableBytes(pages);
  const state = {
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
    dropped: 0,
    disposed: false,
  };
  const emit = (phase: string, message: string, context: () => Record<string, unknown>) => {
    if (onDiagnostic)
      try {
        onDiagnostic({ phase, message, context: context() });
      } catch {
        /* Observers cannot alter streaming. */
      }
  };
  const abortError = () => new DOMException('Page request cancelled', 'AbortError');
  const context: StreamContext = {
    base,
    catalog,
    store,
    cache,
    jobs,
    queue,
    pinned,
    failures,
    abort,
    limit,
    maxPages,
    maxTransferBytes,
    onEvict,
    onDiagnostic,
    state,
    emit,
    abortError,
  };
  const { touch, evict, retain, retainRanks } = createStreamingCache(context);
  // A kept page the catalogue names at another size is another page: it leaves before the first read.
  for (const [url, bytes] of cache)
    if (catalog.has(url) && catalog.get(url)!.bytes !== bytes.byteLength) store.drop(url);
  const release = store.hold({ reservedBytes: tableBytes + maxTransferBytes, evict });
  evict();
  emit('page-catalogue', 'Streamer catalogue and configuration ready', () => ({
    version: 1,
    pages: catalog.size,
    workerCount: limit,
    maxPages: maxPages ?? null,
    maxTransferBytes,
    maxCachedBytes: store.budgetBytes,
    cpuBudgetBytes: store.cpuBytes,
    totalBytes: pages.reduce((sum, page) => sum + page.bytes, 0),
  }));
  const loadOne = createStreamingFetcher(context, touch);
  const { subscribe } = createStreamingQueue(context, loadOne, touch, evict);
  const indexViews = new WeakMap<Uint8Array, Uint32Array>();
  const asIndices = (bytes: Uint8Array) => {
    if (bytes.byteLength % 4 !== 0) throw new Error('INVALID_INDEX_PAGE_SIZE');
    let view = indexViews.get(bytes);
    if (!view) {
      view = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      indexViews.set(bytes, view);
    }
    return view;
  };
  return {
    get(url: string) {
      const array = cache.get(url);
      if (array) touch(url, array);
      return array ? asIndices(array) : undefined;
    },
    getBytes(url: string) {
      const array = cache.get(url);
      if (array) touch(url, array);
      return array;
    },
    has(url: string) {
      return cache.has(url);
    },
    loading(url: string) {
      return jobs.has(url);
    },
    failed(url: string) {
      return failures.has(url);
    },
    read(url: string, requestSignal?: AbortSignal) {
      state.requested++;
      return subscribe(url, requestSignal, 0).then(asIndices);
    },
    readBytes(url: string, requestSignal?: AbortSignal) {
      state.requested++;
      return subscribe(url, requestSignal, 0);
    },
    retain,
    /** Pins by rank delta: neither an address list nor a set rebuilt each frame. */
    retainRanks,
    async request(
      urls: readonly string[],
      options: { signal?: AbortSignal; priority?: number } = {},
    ) {
      const unique = [...new Set(urls.filter((url) => catalog.has(url)))];
      state.requested += unique.length;
      emit('page-request-batch', 'Batched page request received', () => ({
        version: 1,
        requested: urls.length,
        unique: unique.length,
      }));
      await Promise.all(unique.map((url) => subscribe(url, options.signal, options.priority ?? 1)));
    },
    stats() {
      return {
        requested: state.requested,
        loaded: state.loaded,
        hits: state.hits,
        misses: state.misses,
        bytesRead: state.bytesRead,
        loading: state.active,
        queued: queue.length - state.dropped,
        transferInFlightBytes: state.activeBytes,
        resident: cache.size,
        residentBytes: store.bytes,
        maxCachedBytes: store.budgetBytes,
        /** CPU bytes the streamer holds: manifest tables, transfers in flight, cached pages. */
        cpuBytes: tableBytes + state.activeBytes + store.bytes,
        /** The CPU total those count against. */
        cpuBudgetBytes: store.cpuBytes,
        evictions: state.evictions,
        failed: failures.size,
        admissionBlocked: state.admissionBlocked,
      };
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      emit('page-stream-dispose', 'Page streamer released', () => ({
        version: 1,
        resident: cache.size,
        loading: state.active,
        failed: failures.size,
      }));
      abort.abort(abortError());
      for (const job of jobs.values()) job.controller.abort(abortError());
      jobs.clear();
      queue.length = 0;
      state.dropped = 0;
      release();
      // A kept cache is its owner's, for the next session; one of the streamer's own leaves now.
      if (!kept) store.clear();
      pinned.clear();
      failures.clear();
    },
  };
}
