import type { BackendDiagnostic } from '../backend/types.ts'
import type { PageCache } from './pageCache.ts'
import type { LazyDiagnostic } from '../diagnostic/engineDiagnostic.ts'
import type { JobHeap } from './queueOrder.ts'
import type { ReadFailure } from './failures.ts'
import type { RangePart } from './rangeParts.ts'
import type { rangedReader } from '../cluster/ranged.ts'

/**
 * What a frame tells the page cache it keeps: a REQUEST RANK delta, not an address list.
 * Rank is set once and for all by the catalogue, `urls` translates it, and only entries and
 * exits are walked — a cut of fifteen thousand pages that changes only ten therefore
 * costs no ten thousand string hashes per frame. `held` carries full membership: it is
 * used to take over when another engine wrote the pins.
 */
export interface HostRetentionDelta {
  /** Request rank → address. The same table for the life of the scene: its identity names the emitter. */
  readonly urls: readonly string[]
  /** Pages that entered. */
  readonly entered: Int32Array
  /** How many entered. */
  readonly enteredCount: number
  /** Pages that left. */
  readonly exited: Int32Array
  /** How many left. */
  readonly exitedCount: number
  /** Pages held. */
  readonly held: Int32Array
  /** How many held. */
  readonly heldCount: number
}

/** How `request` reads a batch: its cancel, its priority, and what runs as each page lands. */
export interface BatchRead {
  /** Cancels the batch's reads. */ signal?: AbortSignal
  /** Queue priority, 1 by default. */ priority?: number
  /** Runs as each page's read lands, not after the whole batch. */
  onPage?: (url: string) => unknown
}

/** One page a streamer fetches: where, how big, and its fingerprint. */
export interface StreamPage {
  /** Where it is read, or its name in the catalogue when it is a `range` of another file. */
  url: string
  /** Its size. */
  bytes: number
  /** Fingerprint of its bytes; a `range` is checked by its parts' instead. */
  sha256: string
  /** A page that is a range of the file at `file`, from `offset`: read by an HTTP Range, its
   *  bytes checked part by part, where each lies, against each part's size and fingerprint. */
  range?: { file: string; offset: number; parts: readonly RangePart[] }
  /** False for a page whoever asks it keeps what it decodes: read for those who join its read,
   *  never kept in the page cache, its bytes held once. */
  kept?: boolean
}
/** The pages a resource mounted in the open session brings: `admit`-ted before they are
 *  read, `forget`-ten with their bytes once it is unmounted. */
export type PageCatalogue = {
  admit(pages: readonly StreamPage[]): void
  forget(urls: readonly string[]): void
}
/** What a scene's readers ask of the session's queue (`createPageStreamer`): pages admitted, read
 *  at a priority with the signal that lets the asker go, let go, and the reader of a file. */
export type PageQueue = PageCatalogue & {
  readBytes(url: string, signal?: AbortSignal, priority?: number): Promise<Uint8Array>
  /** The ranges of `file` are read through `read`, which its owner counts: one reader a file. */
  readFrom(file: string, read: RangeReader): void
}
/** A reader of a file's ranges (`rangedReader`). */
export type RangeReader = ReturnType<typeof rangedReader>
/** How a page streamer reads (`createPageStreamer`). Beside its pages, its cache reserves its
 *  manifest tables and its transfer queue; every member has a default. */
export interface PageStreamerOptions {
  /** Cancels every read once aborted. */
  signal?: AbortSignal
  /** Reads running at once; 8 by default. */
  workerCount?: number
  /** Most pages held at once; bounded by bytes only when absent. */
  maxPages?: number
  /** Hears each page that leaves the cache. */
  onEvict?: (url: string) => void
  /** Bytes the transfer queue may hold; 8 MiB by default. */
  maxTransferBytes?: number
  /** Hears each step of every read. */
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void
  /** Hears, once, a read that keeps failing past the longest wait. */
  onStalled?: (failure: { url: string; cause: unknown }) => void
  /** Bytes of CPU memory the cache's pages may hold, its manifest tables and transfer queue
   *  reserved on top; 256 MiB by default. */
  maxCachedBytes?: number
}
export type Job = {
  url: string
  priority: number
  order: number
  /** The bytes its transfer holds in flight. */
  bytes: number
  /** Its place in the queue's heap, −1 out of it (`queueOrder.ts`). */
  slot: number
  controller: AbortController
  /** `dropped`: its last consumer left while it was queued, and it was taken out at once. */
  state: 'queued' | 'active' | 'dropped'
  consumers: Set<symbol>
  promise: Promise<Uint8Array>
  resolve: (value: Uint8Array) => void
  reject: (reason: unknown) => void
}

export type StreamContext = {
  base: string
  catalog: Map<string, StreamPage>
  /** The decoded-page cache the streamer reads through, and its pages. */
  store: PageCache
  cache: PageCache['pages']
  jobs: Map<string, Job>
  queue: JobHeap<Job>
  pinned: Set<string>
  failures: Map<string, ReadFailure>
  abort: AbortController
  limit: number
  maxPages?: number
  maxTransferBytes: number
  onEvict?: (url: string) => void
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void
  onStalled?: PageStreamerOptions['onStalled']
  state: {
    order: number
    active: number
    activeBytes: number
    requested: number
    hits: number
    misses: number
    bytesRead: number
    loaded: number
    evictions: number
    admissionBlocked: number
    /** CPU bytes the catalogue's tables hold (`manifestTables.ts`), as pages join and leave it. */
    tableBytes: number
    /** Reads refused now: their wait not over, or never passing (`failures.ts`). */
    refused: number
    disposed: boolean
    /** Bytes the engine's own tables take from the cache's share (`reserve`), read each time
     *  the cache weighs itself: those tables follow the view. */
    reservedBytes: () => number
  }
  /** `undefined` when nobody listens: `emit?.(…)` then builds nothing (`lazyDiagnostic`). */
  emit: LazyDiagnostic | undefined
  abortError: () => DOMException
}
