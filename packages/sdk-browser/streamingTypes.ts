import type { BackendDiagnostic } from './backendTypes.ts';

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
  readonly entered: Int32Array;
  readonly enteredCount: number;
  readonly exited: Int32Array;
  readonly exitedCount: number;
  readonly held: Int32Array;
  readonly heldCount: number;
}

export interface StreamPage {
  url: string;
  bytes: number;
  sha256: string;
}
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
  cache: Map<string, Uint8Array>;
  jobs: Map<string, Job>;
  queue: Job[];
  pinned: Set<string>;
  failures: Map<string, Error>;
  abort: AbortController;
  limit: number;
  maxPages?: number;
  maxTransferBytes: number;
  maxCachedBytes: number;
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
    cachedBytes: number;
  };
  emit: (phase: string, message: string, context: () => Record<string, unknown>) => void;
  abortError: () => DOMException;
};
