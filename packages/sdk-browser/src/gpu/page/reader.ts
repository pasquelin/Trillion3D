import type { PageSource } from '../../../../sdk-core/src/index.ts';
import { refusedStatus } from '../../cluster/checked.ts';
import type { BackendDiagnostic } from '../../backend/types.ts';

export function createGpuPageReader(
  source: PageSource,
  pageBytes: number,
  diagnostic: ((diagnostic: BackendDiagnostic) => void) | undefined,
  fetches: Map<string, Promise<Uint8Array>>,
) {
  const report = typeof diagnostic === 'function' ? diagnostic : undefined;
  const emit = (phase: string, message: string, context: () => Record<string, unknown>) => {
    if (!report) return;
    try {
      report({ phase, message, context: context() });
    } catch {
      /* Diagnostic observers cannot affect the GPU cache. */
    }
  };
  const now = () => (report ? performance.now() : 0);
  const readBytes = (key: string, combined: AbortSignal, attempt: number, priority?: number) => {
    const started = now();
    emit('gpu-page-read-start', 'GPU page read started', () => ({
      version: 1,
      key,
      attempt,
    }));
    emit('gpu-page-attempt-start', 'GPU page read attempt', () => ({
      version: 1,
      key,
      attempt,
      maxAttempts: 2,
    }));
    let raw: Promise<Uint8Array>;
    try {
      raw = source.read(key, combined, priority);
    } catch (error) {
      raw = Promise.reject(error);
    }
    const job = Promise.resolve(raw).then(
      (bytes) => {
        emit('gpu-page-read-end', 'GPU page read finished', () => ({
          version: 1,
          key,
          attempt,
          status: null,
          expectedBytes: pageBytes,
          actualBytes: bytes.byteLength,
          durationMs: report ? performance.now() - started : null,
        }));
        emit('gpu-page-attempt-end', 'GPU read attempt succeeded', () => ({
          version: 1,
          key,
          attempt,
          status: null,
          expectedBytes: pageBytes,
          actualBytes: bytes.byteLength,
          durationMs: report ? performance.now() - started : null,
        }));
        return bytes;
      },
      (error) => {
        emit('gpu-page-read-end', 'GPU page read failed', () => ({
          version: 1,
          key,
          attempt,
          status: refusedStatus(error),
          error: String(error),
          durationMs: report ? performance.now() - started : null,
        }));
        emit('gpu-page-attempt-end', 'GPU read attempt failed', () => ({
          version: 1,
          key,
          attempt,
          status: refusedStatus(error),
          error: String(error),
          durationMs: report ? performance.now() - started : null,
        }));
        throw error;
      },
    );
    return job;
  };
  /** The priority each read still in flight was asked at, when one was given. */
  const asked = new WeakMap<Promise<Uint8Array>, number>();
  const fetchBytes = (key: string, combined: AbortSignal, priority?: number) => {
    const existing = fetches.get(key);
    if (existing) {
      emit('gpu-page-read-coalesced', 'GPU read joined to an in-flight request', () => ({
        version: 1,
        key,
        loading: fetches.size,
      }));
      // A more urgent read joining a prefetch asks the source too: its streamer raises the job
      // it joins, and the view's loading total counts the page it now waits on (#408).
      const was = asked.get(existing);
      if (was !== undefined && (priority === undefined || priority < was)) {
        if (priority === undefined) asked.delete(existing);
        else asked.set(existing, priority);
        try {
          void Promise.resolve(source.read(key, combined, priority)).catch(() => {});
        } catch {
          /* The read in flight reports its own failure. */
        }
      }
      return existing;
    }
    const job = readBytes(key, combined, 1, priority);
    fetches.set(key, job);
    if (priority !== undefined) asked.set(job, priority);
    void job.finally(() => asked.delete(job)).catch(() => {});
    return job;
  };
  return { report, emit, now, readBytes, fetchBytes };
}
