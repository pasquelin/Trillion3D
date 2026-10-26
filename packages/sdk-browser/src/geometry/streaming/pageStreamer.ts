import { DEFAULT_PAGE_TRANSFER_BYTES, DEFAULT_PAGE_WORKERS } from '../../session/engine/common.ts'
import { followSignal } from '../../../../sdk-core/src/runtime/followSignal.ts'
import { createStreamingFetcher } from './fetch.ts'
import { createStreamingQueue } from './queue.ts'
import type { StreamContext, Job, StreamPage, BatchRead, PageStreamerOptions } from './types.ts'
import { createTransferQueue } from './queueRanges.ts'
import { createReadFailures } from './failures.ts'
import { cacheStats, createStreamingCache } from './cache.ts'
import { asIndices } from './indexView.ts'
import { manifestEntryBytes, manifestTableBytes } from './manifestTables.ts'
import { createReadWatch } from './readWatch.ts'
import { lazyDiagnostic } from '../../diagnostic/engineDiagnostic.ts'
/** A ranged page of no bytes is no page: no read would bring it, and the queue's merge of ranges
 *  end to end would stand still on it (`queueRanges.ts`). */
const listed = (page: StreamPage) => !(page.range && page.bytes === 0)

/** The page reads a session streams through (`createPageStreamer`). */
export type PageStreaming = ReturnType<typeof createPageStreamer>

/** Closed (`abort`), every job of `jobs` ends at once, its askers told: one listener, whatever the
 *  jobs. */
function rejectOnAbort(abort: AbortController, jobs: ReadonlyMap<string, Job>) {
  abort.signal.addEventListener(
    'abort',
    () => {
      for (const job of jobs.values()) job.reject(abort.signal.reason)
    },
    { once: true },
  )
}

/** The context the streamer's parts share: the catalogue, the jobs and queue, the failures, the
 *  counters, and the abort that ends them all. `requeue` queues a job again once its wait is over. */
function createContext(
  pages: readonly StreamPage[],
  base: string,
  options: PageStreamerOptions,
  requeue: (job: Job) => void,
): StreamContext {
  const { cache: store, signal, onEvict, onDiagnostic } = options
  const { workerCount = DEFAULT_PAGE_WORKERS, maxTransferBytes = DEFAULT_PAGE_TRANSFER_BYTES } =
    options
  const catalog = new Map(pages.filter(listed).map((page) => [page.url, page]))
  const jobs = new Map<string, Job>(),
    queue = createTransferQueue()
  const pinned = new Map<string, number>(),
    abort = new AbortController()
  // A wait over: a job waiting is queued again by the queue below, made once this is; the failure
  // of a page no longer catalogued leaves.
  const failures = createReadFailures({
    retries: options.numRetries,
    objectOf: options.objectOf,
    onStalled: options.onStalled,
    ended(url) {
      const job = jobs.get(url)
      if (job?.state === 'waiting') requeue(job)
      else if (!catalog.has(url)) failures.leaves(url)
    },
  })
  followSignal(abort, signal)
  rejectOnAbort(abort, jobs)
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
    engineBytes: 0,
  }
  const emit = lazyDiagnostic(onDiagnostic)
  const abortError = () => new DOMException('Page request cancelled', 'AbortError')
  return {
    ...{ base, catalog, store, jobs, queue, pinned, failures, abort, limit },
    ...{ maxTransferBytes, onEvict, onDiagnostic, state, emit, abortError },
  }
}

/** The reads of the pages of bundles, whose bytes hold their own: read, kept and dropped whole,
 *  every page of it served from that one read. */
function createBundleAccess(
  context: StreamContext,
  read: (url: string, signal: AbortSignal, priority?: number) => Promise<Uint8Array>,
) {
  const { catalog, store, state } = context
  /** `url`'s entry when it is a page of a bundle; none when its own entry holds them. */
  const inBundle = (url: string) => {
    const page = catalog.get(url)
    return page?.bundle && (page as StreamPage & Required<Pick<StreamPage, 'bundle'>>)
  }
  type BundlePage = NonNullable<ReturnType<typeof inBundle>>
  /** `page`'s slice of its bundle's `bytes`. */
  const sliced = (bytes: Uint8Array, { bundle, bytes: length }: BundlePage) =>
    bytes.subarray(bundle.offset, bundle.offset + length)
  return {
    inBundle,
    /** `url`'s bytes in the cache, touched: its slice of what holds it. */
    cachedBytes(url: string) {
      const page = inBundle(url)
      if (!page) return store.touch(url)
      const bytes = store.touch(page.bundle.url)
      return bytes && sliced(bytes, page)
    },
    /** The bytes of `url`, read once whatever holds it (`inBundle`). */
    readBytes(url: string, signal: AbortSignal, priority?: number): Promise<Uint8Array> {
      const page = inBundle(url)
      state.requested++
      if (!page) return read(url, signal, priority)
      return read(page.bundle.url, signal, priority).then((bytes) => sliced(bytes, page))
    },
  }
}

/** A kept page held under a page's name as another file leaves before its first read. */
function dropForeign(
  context: StreamContext,
  streaming: ReturnType<typeof createStreamingCache>,
  admitted: readonly StreamPage[],
) {
  for (const page of admitted) if (context.store.foreign(page)) streaming.drop(page.url)
}

/** The catalogue and the configuration, told to who listens. */
function announceCatalogue(context: StreamContext, pages: readonly StreamPage[]) {
  const { catalog, store, emit } = context
  emit?.('page-catalogue', 'Streamer catalogue and configuration ready', () => ({
    version: 1,
    pages: catalog.size,
    workerCount: context.limit,
    maxTransferBytes: context.maxTransferBytes,
    maxCachedBytes: store.budgetBytes,
    cpuBudgetBytes: store.cpuBytes,
    totalBytes: pages.reduce((sum, page) => sum + page.bytes, 0),
  }))
}

/** `more` joins the catalogue, each page kept in the queue (`keep`); the bytes the manifest
 *  tables gained. */
function admitPages(
  context: StreamContext,
  more: readonly StreamPage[],
  keep: (url: string) => void,
) {
  const { catalog } = context
  let tables = 0
  for (const page of more) {
    if (!listed(page)) continue
    keep(page.url)
    if (!catalog.has(page.url)) tables += manifestEntryBytes(page.url)
    catalog.set(page.url, page)
  }
  return tables
}

/** Reads `urls` the catalog holds, once each, each landing handed to `onPage` at once; it
 *  settles once every read and `onPage` has, rejecting with the first failure in `urls` order. */
async function requestBatch(
  context: StreamContext,
  readBytes: (url: string, signal: AbortSignal, priority?: number) => Promise<Uint8Array>,
  urls: readonly string[],
  options: BatchRead,
) {
  const unique = [...new Set(urls.filter((url) => context.catalog.has(url)))]
  context.emit?.('page-request-batch', 'Batched page request received', () => ({
    version: 1,
    requested: urls.length,
    unique: unique.length,
  }))
  const { signal, priority, onPage } = options
  const landed = await Promise.allSettled(
    unique.map((url) => readBytes(url, signal, priority).then((bytes) => onPage?.(url, bytes))),
  )
  for (const page of landed) if (page.status === 'rejected') throw page.reason
}

/** The counters of the streamer. */
function streamerStats(context: StreamContext) {
  const { state, queue, store, failures } = context
  return {
    requested: state.requested,
    loaded: state.loaded,
    hits: state.hits,
    misses: state.misses,
    bytesRead: state.bytesRead,
    loading: state.active,
    queued: queue.size,
    transferInFlightBytes: state.activeBytes,
    ...cacheStats(store),
    /** CPU bytes held (manifest tables, transfers, the engine's tables, the cache's entries). */
    cpuBytes: state.tableBytes + state.activeBytes + state.engineBytes + store.bytes,
    cpuBudgetBytes: store.cpuBytes,
    evictions: state.evictions,
    /** Reads that failed and do not pass now: waiting their turn, or refused for good. */
    failed: failures.count(),
    admissionBlocked: state.admissionBlocked,
  }
}

/** The streamer released: its reads ended, its pins and transfers given back. */
function disposeStreamer(
  context: StreamContext,
  streaming: ReturnType<typeof createStreamingCache>,
) {
  const { state, emit, store, failures, abort, jobs, queue, abortError } = context
  if (state.disposed) return
  state.disposed = true
  emit?.('page-stream-dispose', 'Page streamer released', () => ({
    version: 1,
    resident: store.pageCount,
    loading: state.active,
    failed: failures.count(),
  }))
  abort.abort(abortError())
  // The cache is its owner's, for the next session: the session's pins and transfers give
  // their holds back before the jobs are let go.
  streaming.close()
  jobs.clear()
  queue.clear()
  failures.clear()
}

/** Bounded, prioritized and deduplicated reads through `options.cache`, the page cache its owner
 *  keeps (`pageCache.ts`). A request still waiting in the queue is dropped once its last consumer
 *  leaves; one already transferring is allowed to land in the cache. The cache is a
 *  least-recently-used set bounded by bytes; a page with an owner (`pin`, `retainRanks`) survives
 *  eviction, so a caller keeps its displayed cover by pinning it. */
export function createPageStreamer(
  pages: readonly StreamPage[],
  base: string,
  options: PageStreamerOptions,
) {
  const context = createContext(pages, base, options, (job) => reads.requeue(job))
  const { catalog, store, abort } = context
  const { read: transfer } = createStreamingFetcher(context)
  const streaming = createStreamingCache(context)
  const { pin, unpin, retainRanks, reserve } = streaming
  dropForeign(context, streaming, pages)
  streaming.open()
  announceCatalogue(context, pages)
  const reads = createStreamingQueue(context, transfer, streaming)
  const { forget, keep } = reads
  const { read, watch } = createReadWatch(reads.subscribe)
  const { inBundle, cachedBytes, readBytes } = createBundleAccess(context, read)
  return {
    /** How many times a read that failed is tried again, the setting the texture levels' reads share. */
    numRetries: options.numRetries,
    admit(more: readonly StreamPage[]) {
      dropForeign(context, streaming, more)
      const tables = admitPages(context, more, keep)
      if (tables) streaming.tables(tables)
    },
    // A page a read holds, queued or in transfer, stays catalogued until that read settles.
    forget: (urls: readonly string[]) => urls.forEach(forget),
    get(url: string) {
      const array = cachedBytes(url)
      return array ? asIndices(array) : undefined
    },
    getBytes: cachedBytes,
    has: (url: string) => store.page(inBundle(url)?.bundle.url ?? url) !== undefined,
    /** Whether the catalogue names `url`: a page `admit` took and `forget` has not let go. */
    catalogued: (url: string) => catalog.has(url),
    loading: (url: string) => context.jobs.has(url),
    /** Whether a read of `url` is given up: it failed past its tries. */
    failed: (url: string) => context.failures.blocked(url)?.state === 'refused',
    read: (url: string, signal: AbortSignal) => readBytes(url, signal).then(asIndices),
    readBytes,
    /** Bytes of a file outside the catalogue, by an HTTP Range through the page cache. */
    readRange: store.readRange,
    /** The streamer's life, aborted once it is disposed or its owner's signal aborts. */
    signal: abort.signal,
    reserve,
    /** One more owner of `url`'s page: kept in the cache until `unpin` lets it go. */
    pin,
    unpin,
    /** The engine's pins by rank delta: neither an address list nor a set rebuilt each frame. */
    retainRanks,
    /** Hears every page read, whoever asks it, until the returned stop runs (`readWatch.ts`). */
    watch,
    /** Reads `urls` the catalog holds, once each, each landing handed to `onPage` at once; it
     *  settles once every read and `onPage` has, rejecting with the first failure in `urls` order. */
    request: (urls: readonly string[], options: BatchRead) =>
      requestBatch(context, readBytes, urls, options),
    stats: () => streamerStats(context),
    dispose: () => disposeStreamer(context, streaming),
  }
}
