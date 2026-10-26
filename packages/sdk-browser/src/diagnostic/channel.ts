import type { EngineDiagnostic, DiagnosticDetail } from './types.ts'
import { microtaskOnce } from '../../../sdk-core/src/runtime/microtaskOnce.ts'

/** A function that hears each thing a diagnostic channel reports. */
export type DiagnosticObserver = (diagnostic: EngineDiagnostic) => void

/** How much a diagnostic channel says. */
export interface DiagnosticChannelOptions {
  /** Explicitly disable delivery while retaining a cheap no-op emitter. */
  enabled?: boolean
  /** A summary, or every detail. */
  detail?: DiagnosticDetail
  /** Maximum number of pending diagnostic records. */
  maxBuffer?: number
  /** A stable caller supplied session id is useful when several explorers coexist. */
  sessionId?: string
  /** Epoch milliseconds; injectable for deterministic tests. */
  now?: () => number
}

/** A line the engine reports its findings on, until it is closed. */
export interface DiagnosticChannel {
  /** Whether it reports. */
  readonly enabled: boolean
  /** How much it says. */
  readonly detail: DiagnosticDetail
  /** The session it belongs to. */
  readonly sessionId: string
  /** Reports one finding. */
  emit(diagnostic: EngineDiagnostic): void
  /** Delivers what waits. */
  flush(): Promise<void>
  /** Drain outside a measured/render call when a synchronous teardown needs delivery. */
  flushSync(): void
  /** Stops it. */
  close(): void
  /** Findings waiting. */
  pending(): number
  /** Findings dropped. */
  dropped(): number
}

let sessionCounter = 0
const defaultNow = () => Date.now()
const newSessionId = () =>
  `diagnostics-${Date.now().toString(36)}-${(++sessionCounter).toString(36)}`
const isFrameDiagnostic = (diagnostic: EngineDiagnostic) =>
  diagnostic.phase === 'frame' || diagnostic.context?.kind === 'frame'

/** The findings the full buffer dropped, counted until a loss record reports them. */
function createLossLedger(sessionId: string, maxBuffer: number, now: () => number) {
  let droppedCount = 0
  let droppedTotal = 0
  let firstDroppedSequence: number | undefined
  let lastDroppedSequence: number | undefined
  return {
    /** Findings dropped since the last loss record. */
    unreported: () => droppedCount,
    total: () => droppedTotal,
    drop(sequence: number) {
      droppedCount++
      droppedTotal++
      firstDroppedSequence ??= sequence
      lastDroppedSequence = sequence
    },
    /** The loss record for what was dropped since the last one, and the count starts again. */
    take(): EngineDiagnostic | undefined {
      if (!droppedCount || firstDroppedSequence === undefined || lastDroppedSequence === undefined)
        return undefined
      const queuedAt = now()
      const record: EngineDiagnostic = {
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
      }
      droppedCount = 0
      firstDroppedSequence = undefined
      lastDroppedSequence = undefined
      return record
    },
  }
}

/** `input` with its place in the channel's order and its times. */
const stamp = (
  sessionId: string,
  input: EngineDiagnostic,
  sequence: number,
  queuedAt: number,
): EngineDiagnostic => ({
  ...input,
  sequence,
  sessionId,
  queuedAt,
  createdAt:
    input.createdAt ??
    (typeof input.context.createdAt === 'number' ? input.context.createdAt : queuedAt),
})

/** The bounded buffer of a channel: findings stamped in order, delivered to `observer` on `drain`,
 *  the overflow counted by the loss ledger. */
function createDiagnosticQueue(
  observer: DiagnosticObserver | undefined,
  enabled: boolean,
  maxBuffer: number,
  sessionId: string,
  now: () => number,
) {
  const queue: EngineDiagnostic[] = []
  let nextSequence = 0
  const loss = createLossLedger(sessionId, maxBuffer, now)
  const deliver = (record: EngineDiagnostic) => {
    try {
      observer?.(record)
    } catch {
      /* Observer failures are isolated from the engine. */
    }
  }
  return {
    pending: () => queue.length,
    unreported: loss.unreported,
    total: loss.total,
    push(input: EngineDiagnostic) {
      const sequence = ++nextSequence
      const record = stamp(sessionId, input, sequence, now())
      if (queue.length >= maxBuffer) {
        loss.drop(sequence)
      } else queue.push(record)
    },
    drain() {
      if (!enabled) return
      const batch = queue.splice(0, queue.length)
      for (const record of batch) deliver(record)
      const lost = loss.take()
      if (lost) deliver(lost)
      // An observer may enqueue while it is being called. Leave it for a fresh
      // deferred turn so a faulty observer cannot monopolize the event loop.
    },
  }
}

/** The channel's settings: each option as given, else its default. */
function channelSettings(
  observer: DiagnosticObserver | undefined,
  options: DiagnosticChannelOptions,
) {
  return {
    enabled: options.enabled ?? observer !== undefined,
    detail: options.detail ?? 'trace',
    maxBuffer:
      Number.isSafeInteger(options.maxBuffer) && options.maxBuffer! > 0
        ? options.maxBuffer!
        : 65536,
    now: options.now ?? defaultNow,
    sessionId: options.sessionId ?? newSessionId(),
  }
}

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
  const { enabled, detail, maxBuffer, now, sessionId } = channelSettings(observer, options)
  const queue = createDiagnosticQueue(observer, enabled, maxBuffer, sessionId, now)
  let closed = false
  let flushing: Promise<void> | undefined

  const turn = microtaskOnce(() => void channel.flush())
  const schedule = () => {
    if (!flushing && enabled) turn.schedule()
  }
  const channel: DiagnosticChannel = {
    enabled,
    detail,
    sessionId,
    emit(input) {
      if (closed || !enabled) return
      // Summary retains host/backend lifecycle evidence and omits per-frame trace
      // volume, matching the pre-trace reporting volume.
      if (detail === 'summary' && isFrameDiagnostic(input)) return
      queue.push(input)
      schedule()
    },
    flush() {
      if (!enabled || (closed && queue.pending() === 0 && !queue.unreported()))
        return Promise.resolve()
      if (flushing) return flushing
      flushing = Promise.resolve()
        .then(queue.drain)
        .finally(() => {
          flushing = undefined
          if (queue.pending() || queue.unreported()) schedule()
        })
      return flushing
    },
    flushSync() {
      if (!enabled) return
      turn.reset()
      queue.drain()
    },
    close() {
      if (closed) return
      closed = true
      schedule()
    },
    pending: queue.pending,
    dropped: queue.total,
  }
  return channel
}
