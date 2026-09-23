import type { BackendDiagnostic } from '../../../backend/types.ts';

export function createWebgpuDiagnostics(
  onDiagnostic: ((diagnostic: BackendDiagnostic) => void) | undefined,
  traceEnabled: boolean,
) {
  type TraceDiagnostic = { phase: string; message: string; context: Record<string, unknown> };
  const traceQueue: TraceDiagnostic[] = [];
  const maxTraceQueue = 65536;
  let droppedTraceDiagnostics = 0,
    traceLossPending = 0;
  let traceScheduled = false;
  const drainTraceNow = () => {
    const batch = traceQueue.splice(0);
    for (const event of batch) {
      try {
        onDiagnostic?.(event);
      } catch {
        /* Host collectors do not control rendering. */
      }
    }
    if (traceLossPending) {
      const dropped = traceLossPending;
      traceLossPending = 0;
      try {
        onDiagnostic?.({
          phase: 'diagnostic-loss',
          message: 'Trace diagnostics dropped to stay within the memory bound',
          context: {
            pipelineVersion: 1,
            backend: 'webgpu-page-raster',
            dropped,
            queueLimit: maxTraceQueue,
          },
        });
      } catch {
        /* Host collectors do not control rendering. */
      }
    }
  };
  const flushTraceQueue = () => {
    if (traceScheduled || !traceQueue.length) return;
    traceScheduled = true;
    queueMicrotask(() => {
      traceScheduled = false;
      drainTraceNow();
      if (traceQueue.length) flushTraceQueue();
    });
  };
  const traceDiagnostic = (
    phase: string,
    message: string,
    details: Record<string, unknown> | (() => Record<string, unknown>),
  ) => {
    if (!traceEnabled) return;
    if (traceQueue.length >= maxTraceQueue) {
      droppedTraceDiagnostics++;
      traceLossPending++;
      return;
    }
    const payload = typeof details === 'function' ? details() : details;
    traceQueue.push({
      phase,
      message,
      context: {
        pipelineVersion: 1,
        createdAt: Date.now(),
        ...payload,
        droppedDiagnostics: droppedTraceDiagnostics || undefined,
      },
    });
    flushTraceQueue();
  };
  const engineDiagnostic = (phase: string, message: string, details: Record<string, unknown>) => {
    try {
      onDiagnostic?.({ phase, message, context: { pipelineVersion: 1, ...details } });
    } catch {
      /* Observers do not control rendering. */
    }
  };
  const loggedFailures = new Set<string>(),
    failureOccurrences = new Map<string, number>();
  const diagnosticFailure = (phase: string, error: unknown) => {
    const objectError =
      error && typeof error === 'object'
        ? (error as { message?: unknown; name?: unknown; stack?: unknown; cause?: unknown })
        : undefined;
    const details = {
      error: objectError?.message !== undefined ? String(objectError.message) : String(error),
      backend: 'webgpu-page-raster',
    };
    const occurrence = (failureOccurrences.get(phase) ?? 0) + 1;
    failureOccurrences.set(phase, occurrence);
    if (traceEnabled) {
      traceDiagnostic(phase, 'WebGPU path failed', () => ({
        ...details,
        name: objectError?.name ? String(objectError.name) : undefined,
        stack: objectError?.stack ? String(objectError.stack).slice(0, 8192) : undefined,
        cause:
          objectError?.cause === undefined ? undefined : String(objectError.cause).slice(0, 2048),
        occurrence,
      }));
      return;
    }
    if (loggedFailures.has(phase)) return;
    loggedFailures.add(phase);
    engineDiagnostic(phase, 'WebGPU path failed', details);
  };
  return { traceDiagnostic, engineDiagnostic, diagnosticFailure, drainTraceNow };
}
