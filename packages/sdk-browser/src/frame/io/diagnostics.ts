import type { EngineDiagnostic } from '../../diagnostic/types.ts'
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts'
import { isCancelled } from '../../session/engine/common.ts'
import { log } from '../../diagnostic/log.ts'
import { microtaskOnce } from '../../../../sdk-core/src/runtime/microtaskOnce.ts'
import { countBy } from '../../../../math/src/sequence/counts.ts'

/** The backend's diagnostic channel (`createWebgpuDiagnostics`). */
export type WebgpuDiagnosticChannel = ReturnType<typeof createWebgpuDiagnostics>

/**
 * The backend's diagnostic channel. What the session says once its `signal` is aborted — the
 * session disposed, its pending compiles, layers and uploads cut short by the released device — is
 * that cancellation, not a failure nor a warning: it is said nowhere. A real device loss aborts
 * nothing, and its failures are said by name.
 */
export function createWebgpuDiagnostics(
  onDiagnostic: ((diagnostic: EngineDiagnostic) => void) | undefined,
  traceEnabled: boolean,
  signal?: AbortSignal,
) {
  const t: TraceQueue = {
    ...{ onDiagnostic, traceEnabled, queue: [] },
    ...{ dropped: 0, lossPending: 0 },
    turn: microtaskOnce(() => {
      drain(t)
      flush(t)
    }),
  }
  const traceDiagnostic = (
    phase: string,
    message: string,
    details: Record<string, unknown> | (() => Record<string, unknown>),
  ) => trace(t, phase, message, details)
  const drainTraceNow = () => drain(t)
  const engineDiagnostic = (phase: string, message: string, details: Record<string, unknown>) => {
    if (!isCancelled(signal)) sendEngineDiagnostic(onDiagnostic, phase, message, details)
  }
  const f: Failures = {
    ...{ signal, traceEnabled, traceDiagnostic, engineDiagnostic },
    logged: new Set(),
    occurrences: new Map(),
  }
  const diagnosticFailure = (phase: string, error: unknown) => failure(f, phase, error)
  /** Whether a diagnostic channel listens: what it hears is then measured (`endCpuFrame`). */
  const listened = !!onDiagnostic
  return { traceDiagnostic, engineDiagnostic, diagnosticFailure, drainTraceNow, listened }
}

const MAX_TRACE_QUEUE = 65536
type TraceDiagnostic = { phase: string; message: string; context: Record<string, unknown> }
type TraceQueue = {
  onDiagnostic: ((diagnostic: EngineDiagnostic) => void) | undefined
  traceEnabled: boolean
  queue: TraceDiagnostic[]
  dropped: number
  lossPending: number
  /** The drain's microtask, asked again while the queue holds traces. */
  turn: ReturnType<typeof microtaskOnce>
}
type Failures = {
  signal: AbortSignal | undefined
  traceEnabled: boolean
  traceDiagnostic: (phase: string, message: string, details: () => Record<string, unknown>) => void
  engineDiagnostic: (phase: string, message: string, details: Record<string, unknown>) => void
  logged: Set<string>
  occurrences: Map<string, number>
}

function drain(t: TraceQueue) {
  const { onDiagnostic } = t
  const batch = t.queue.splice(0)
  for (const event of batch) {
    try {
      onDiagnostic?.(event)
    } catch {
      /* Host collectors do not control rendering. */
    }
  }
  if (t.lossPending) {
    const dropped = t.lossPending
    t.lossPending = 0
    try {
      onDiagnostic?.({
        phase: 'diagnostic-loss',
        message: 'Trace diagnostics dropped to stay within the memory bound',
        context: {
          pipelineVersion: 1,
          dropped,
          queueLimit: MAX_TRACE_QUEUE,
        },
      })
    } catch {
      /* Host collectors do not control rendering. */
    }
  }
}

function flush(t: TraceQueue) {
  if (t.queue.length) t.turn.schedule()
}

function trace(
  t: TraceQueue,
  phase: string,
  message: string,
  details: Record<string, unknown> | (() => Record<string, unknown>),
) {
  if (!t.traceEnabled) return
  if (t.queue.length >= MAX_TRACE_QUEUE) {
    t.dropped++
    t.lossPending++
    return
  }
  const payload = typeof details === 'function' ? details() : details
  t.queue.push({
    phase,
    message,
    context: {
      pipelineVersion: 1,
      createdAt: Date.now(),
      ...payload,
      droppedDiagnostics: t.dropped || undefined,
    },
  })
  flush(t)
}

function failure(f: Failures, phase: string, error: unknown) {
  if (isCancelled(f.signal)) return
  const objectError =
    error && typeof error === 'object'
      ? (error as { message?: unknown; name?: unknown; stack?: unknown; cause?: unknown })
      : undefined
  const details = {
    error: objectError?.message !== undefined ? String(objectError.message) : String(error),
  }
  const occurrence = countBy(f.occurrences, phase, 1)
  // A failed path is said on the console too, once per kind: with no diagnostic channel open —
  // the default — it would otherwise leave a blank or degraded image and nothing to read.
  if (occurrence === 1) log.warn(`WebGPU ${phase}: ${details.error}`)
  if (f.traceEnabled) {
    f.traceDiagnostic(phase, 'WebGPU path failed', () => ({
      ...details,
      name: objectError?.name ? String(objectError.name) : undefined,
      stack: objectError?.stack ? String(objectError.stack).slice(0, 8192) : undefined,
      cause:
        objectError?.cause === undefined ? undefined : String(objectError.cause).slice(0, 2048),
      occurrence,
    }))
    return
  }
  if (f.logged.has(phase)) return
  f.logged.add(phase)
  f.engineDiagnostic(phase, 'WebGPU path failed', details)
}
