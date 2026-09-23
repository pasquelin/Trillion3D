import type { PageSource } from '../../../../sdk-core/src/index.ts';
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
  const statusOf = (error: unknown) => {
    const match = String(error).match(/PAGE_HTTP_(\d{3})/);
    return match ? Number(match[1]) : null;
  };
  const readBytes = (key: string, combined: AbortSignal, attempt: number) => {
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
      raw = source.read(key, combined);
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
          status: statusOf(error),
          error: String(error),
          durationMs: report ? performance.now() - started : null,
        }));
        emit('gpu-page-attempt-end', 'GPU read attempt failed', () => ({
          version: 1,
          key,
          attempt,
          status: statusOf(error),
          error: String(error),
          durationMs: report ? performance.now() - started : null,
        }));
        throw error;
      },
    );
    return job;
  };
  const fetchBytes = (key: string, combined: AbortSignal) => {
    const existing = fetches.get(key);
    if (existing) {
      emit('gpu-page-read-coalesced', 'GPU read joined to an in-flight request', () => ({
        version: 1,
        key,
        loading: fetches.size,
      }));
      return existing;
    }
    const job = readBytes(key, combined, 1);
    fetches.set(key, job);
    void job.catch(() => {});
    return job;
  };
  return { report, emit, now, statusOf, readBytes, fetchBytes };
}
