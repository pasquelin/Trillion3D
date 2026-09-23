import type { BackendDiagnostic, DiagnosticDetail } from '../backend/types.ts';

/** A function that hears each thing a diagnostic channel reports. */
export type DiagnosticObserver = (diagnostic: BackendDiagnostic) => void;

/** How much a diagnostic channel says. */
export interface DiagnosticChannelOptions {
  /** Explicitly disable delivery while retaining a cheap no-op emitter. */
  enabled?: boolean;
  /** A summary, or every detail. */
  detail?: DiagnosticDetail;
  /** Maximum number of pending diagnostic records. */
  maxBuffer?: number;
  /** A stable caller supplied session id is useful when several explorers coexist. */
  sessionId?: string;
  /** Epoch milliseconds; injectable for deterministic tests. */
  now?: () => number;
}

/** A line the engine reports its findings on, until it is closed. */
export interface DiagnosticChannel {
  /** Whether it reports. */
  readonly enabled: boolean;
  /** How much it says. */
  readonly detail: DiagnosticDetail;
  /** The session it belongs to. */
  readonly sessionId: string;
  /** Reports one finding. */
  emit(diagnostic: BackendDiagnostic): void;
  /** Delivers what waits. */
  flush(): Promise<void>;
  /** Drain outside a measured/render call when a synchronous teardown needs delivery. */
  flushSync(): void;
  /** Stops it. */
  close(): void;
  /** Findings waiting. */
  pending(): number;
  /** Findings dropped. */
  dropped(): number;
}

let sessionCounter = 0;
const defaultNow = () => Date.now();
const newSessionId = () =>
  `diagnostics-${Date.now().toString(36)}-${(++sessionCounter).toString(36)}`;
const isFrameDiagnostic = (diagnostic: BackendDiagnostic) =>
  diagnostic.phase === 'frame' || diagnostic.context?.kind === 'frame';

/**
 * Bounded, asynchronous diagnostic delivery for browser hosts.
 *
 * `emit` only appends the already-created record and schedules a microtask. It
 * never invokes user code and never serializes a record. This keeps observers
 * outside a measured render call; `flush` is the explicit host synchronization
 * point for preparation/streaming reports.
 */
export function createDiagnosticChannel(
  observer: DiagnosticObserver | undefined,
  options: DiagnosticChannelOptions = {},
): DiagnosticChannel {
  const enabled = options.enabled ?? observer !== undefined;
  const detail = options.detail ?? 'trace';
  const maxBuffer =
    Number.isSafeInteger(options.maxBuffer) && options.maxBuffer! > 0 ? options.maxBuffer! : 65536;
  const now = options.now ?? defaultNow;
  const sessionId = options.sessionId ?? newSessionId();
  const queue: BackendDiagnostic[] = [];
  let nextSequence = 0;
  let droppedCount = 0;
  let droppedTotal = 0;
  let firstDroppedSequence: number | undefined;
  let lastDroppedSequence: number | undefined;
  let scheduled = false;
  let closed = false;
  let flushing: Promise<void> | undefined;

  const stamp = (
    input: BackendDiagnostic,
    sequence: number,
    queuedAt: number,
  ): BackendDiagnostic => ({
    ...input,
    sequence,
    sessionId,
    queuedAt,
    createdAt:
      input.createdAt ??
      (typeof input.context.createdAt === 'number' ? input.context.createdAt : queuedAt),
  });
  const lossRecord = (): BackendDiagnostic | undefined => {
    if (!droppedCount || firstDroppedSequence === undefined || lastDroppedSequence === undefined)
      return undefined;
    const queuedAt = now();
    const record: BackendDiagnostic = {
      phase: 'diagnostic-loss',
      message: 'Diagnostics were dropped because the bounded buffer was full',
      context: {
        kind: 'loss',
        dropped: true,
        lostCount: droppedCount,
        firstSequence: firstDroppedSequence,
        lastSequence: lastDroppedSequence,
        bufferCapacity: maxBuffer,
      },
      sequence: lastDroppedSequence,
      sessionId,
      queuedAt,
      createdAt: queuedAt,
    };
    droppedCount = 0;
    firstDroppedSequence = undefined;
    lastDroppedSequence = undefined;
    return record;
  };
  const deliver = (record: BackendDiagnostic) => {
    try {
      observer?.(record);
    } catch {
      /* Observer failures are isolated from the engine. */
    }
  };
  const drain = () => {
    if (!enabled) return;
    const batch = queue.splice(0, queue.length);
    for (const record of batch) deliver(record);
    const loss = lossRecord();
    if (loss) deliver(loss);
    // An observer may enqueue while it is being called. Leave it for a fresh
    // deferred turn so a faulty observer cannot monopolize the event loop.
  };
  const schedule = () => {
    if (scheduled || flushing || !enabled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void channel.flush();
    });
  };
  const channel: DiagnosticChannel = {
    enabled,
    detail,
    sessionId,
    emit(input) {
      if (closed || !enabled) return;
      // Summary retains host/backend lifecycle evidence and omits per-frame trace
      // volume, matching the pre-trace reporting volume.
      if (detail === 'summary' && isFrameDiagnostic(input)) return;
      const sequence = ++nextSequence;
      const record = stamp(input, sequence, now());
      if (queue.length >= maxBuffer) {
        droppedCount++;
        droppedTotal++;
        firstDroppedSequence ??= sequence;
        lastDroppedSequence = sequence;
      } else queue.push(record);
      schedule();
    },
    flush() {
      if (!enabled || (closed && queue.length === 0 && !droppedCount)) return Promise.resolve();
      if (flushing) return flushing;
      flushing = Promise.resolve()
        .then(drain)
        .finally(() => {
          flushing = undefined;
          if (queue.length || droppedCount) schedule();
        });
      return flushing;
    },
    flushSync() {
      if (!enabled) return;
      scheduled = false;
      drain();
    },
    close() {
      if (closed) return;
      closed = true;
      schedule();
    },
    pending: () => queue.length,
    dropped: () => droppedTotal,
  };
  return channel;
}
