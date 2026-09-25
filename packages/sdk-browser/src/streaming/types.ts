import type { BackendDiagnostic } from '../backend/types.ts';
import type { PageCache } from './pageCache.ts';

/**
 * What a frame tells the page cache it keeps: a REQUEST RANK delta, not an address list.
 * Rank is set once and for all by the catalogue, `urls` translates it, and only entries and
 * exits are walked — a cut of fifteen thousand pages that changes only ten therefore no
 * longer costs ten thousand string hashes per frame. `held` carries full membership: it is
 * used to take over when another engine wrote the pins.
 */
export interface HostRetentionDelta {
  /** Request rank → address. The same table for the life of the scene: its identity names the emitter. */
  readonly urls: readonly string[];
  /** Pages that entered. */
  readonly entered: Int32Array;
  /** How many entered. */
  readonly enteredCount: number;
  /** Pages that left. */
  readonly exited: Int32Array;
  /** How many left. */
  readonly exitedCount: number;
  /** Pages held. */
  readonly held: Int32Array;
  /** How many held. */
  readonly heldCount: number;
}

/** One page a streamer fetches: where, how big, and its fingerprint. */
export interface StreamPage {
  /** Where it is read. */
  url: string;
  /** Its size. */
  bytes: number;
  /** Fingerprint of its bytes. */
  sha256: string;
}
// How a page streamer reads (`createPageStreamer`). `cache` is the decoded-page cache its owner
// keeps across sessions: off its CPU total, the streamer reserves its manifest tables, its
// transfer queue (`maxTransferBytes`, 8 MiB by default) and the engine's tables (`reserve`), and
// leaves the pages to the next session. Without it, the streamer's own cache holds
// `maxCachedBytes` of pages beside those reservations, emptied at dispose. `workerCount` reads
// (8 by default) run at once, `maxPages` bounds the resident entries, `onEvict` hears each page
// that leaves, `onDiagnostic` each step.
export type PageStreamerOptions = {
  cache?: PageCache;
  signal?: AbortSignal;
  workerCount?: number;
  maxPages?: number;
  onEvict?: (url: string) => void;
  maxTransferBytes?: number;
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
  maxCachedBytes?: number;
};
export type Job = {
  url: string;
  priority: number;
  order: number;
  controller: AbortController;
  /** `dropped`: no consumer left, the queue drops it on the next `pump` pass. */
  state: 'queued' | 'active' | 'dropped';
  consumers: Set<symbol>;
  promise: Promise<Uint8Array>;
  resolve: (value: Uint8Array) => void;
  reject: (reason: unknown) => void;
};

export type StreamContext = {
  base: string;
  catalog: Map<string, StreamPage>;
  /** The decoded-page cache the streamer reads through, and its pages. */
  store: PageCache;
  cache: PageCache['pages'];
  jobs: Map<string, Job>;
  queue: Job[];
  pinned: Set<string>;
  failures: Map<string, Error>;
  abort: AbortController;
  limit: number;
  maxPages?: number;
  maxTransferBytes: number;
  onEvict?: (url: string) => void;
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
  state: {
    order: number;
    active: number;
    activeBytes: number;
    requested: number;
    hits: number;
    misses: number;
    bytesRead: number;
    loaded: number;
    evictions: number;
    admissionBlocked: number;
    /** Jobs marked abandoned but still in the queue array. */
    dropped: number;
    disposed: boolean;
    /** Bytes the engine's own tables take from the cache's share (`reserve`), read each time
     *  the cache weighs itself: those tables follow the view. */
    reservedBytes: () => number;
  };
  emit: (phase: string, message: string, context: () => Record<string, unknown>) => void;
  abortError: () => DOMException;
};
