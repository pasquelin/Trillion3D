import type { PageSource } from '../sdk-core/index.ts';
import type { BackendDiagnostic } from './backendTypes.ts';

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
    emit('gpu-page-read-start', 'Lecture de page GPU démarrée', () => ({
      version: 1,
      key,
      attempt,
    }));
    emit('gpu-page-attempt-start', 'Tentative de lecture de page GPU', () => ({
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
        emit('gpu-page-read-end', 'Lecture de page GPU terminée', () => ({
          version: 1,
          key,
          attempt,
          status: null,
          expectedBytes: pageBytes,
          actualBytes: bytes.byteLength,
          durationMs: report ? performance.now() - started : null,
        }));
        emit('gpu-page-attempt-end', 'Tentative de lecture GPU réussie', () => ({
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
        emit('gpu-page-read-end', 'Lecture de page GPU échouée', () => ({
          version: 1,
          key,
          attempt,
          status: statusOf(error),
          error: String(error),
          durationMs: report ? performance.now() - started : null,
        }));
        emit('gpu-page-attempt-end', 'Tentative de lecture GPU échouée', () => ({
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
      emit('gpu-page-read-coalesced', 'Lecture GPU jointe à une demande en cours', () => ({
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
