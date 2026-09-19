import type { GpuPageContext, ResidentPage } from './gpuPageTypes.ts';
import { commitGpuPage } from './gpuPageCommit.ts';

export function createGpuPageLoader(context: GpuPageContext) {
  const { abort, resident, fetches, state, reader, check, pageBytes, pins } = context;
  const { report, emit, now, statusOf, readBytes, fetchBytes } = reader;
  return function load(key: string, signal?: AbortSignal): Promise<ResidentPage> {
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const abortListener =
      report && signal
        ? () =>
            emit('gpu-page-abort', 'GPU load cancelled', () => ({
              version: 1,
              key,
              reason: String(signal.reason ?? 'aborted'),
            }))
        : undefined;
    if (abortListener) signal?.addEventListener('abort', abortListener, { once: true });
    const requestStarted = now();
    emit('gpu-page-request', 'GPU page request received', () => ({
      version: 1,
      key,
      resident: resident.has(key),
      loading: fetches.has(key),
    }));
    const fetched = !state.disposed && !resident.has(key) ? fetchBytes(key, combined) : undefined;
    const operation = state.pending.then(async () => {
      const queueStarted = now();
      try {
        check(combined);
        emit('gpu-page-queue-wait', 'GPU load CPU queue wait finished', () => ({
          version: 1,
          key,
          durationMs: report ? queueStarted - requestStarted : null,
        }));
        const existing = resident.get(key);
        if (existing) {
          resident.delete(key);
          resident.set(key, existing);
          emit('gpu-page-cache-hit', 'GPU page already resident', () => ({
            version: 1,
            key,
            slot: existing.slot,
            generation: existing.generation,
            source: 'resident-cache',
          }));
          return existing;
        }
        emit('gpu-page-cache-miss', 'Page absent from GPU residency', () => ({
          version: 1,
          key,
          source: 'page-source',
        }));
        let bytes: Uint8Array;
        try {
          bytes = await (fetched ?? fetchBytes(key, combined));
        } catch (err) {
          if (!combined.aborted && !state.disposed) {
            emit('gpu-page-retry', 'New GPU read after failure', () => ({
              version: 1,
              key,
              attempt: 1,
              nextAttempt: 2,
              error: String(err),
            }));
            bytes = await readBytes(key, combined, 2);
          } else throw err;
        }
        check(combined);
        if (bytes.byteLength > pageBytes || bytes.byteLength === 0) {
          emit('gpu-page-corruption', 'Unexpected GPU page size', () => ({
            version: 1,
            key,
            reason: 'page-size-mismatch',
            expectedBytes: pageBytes,
            actualBytes: bytes.byteLength,
          }));
          emit('gpu-page-admission-blocked', 'Page refused by a GPU slot capacity', () => ({
            version: 1,
            key,
            reason: 'page-size-mismatch',
            expectedBytes: pageBytes,
            actualBytes: bytes.byteLength,
          }));
          throw new Error('PAGE_SIZE_MISMATCH');
        }
        return commitGpuPage(context, key, bytes, requestStarted);
      } catch (error) {
        emit('gpu-page-error', 'GPU load failed', () => ({
          version: 1,
          key,
          status: statusOf(error),
          aborted: combined.aborted,
          error: String(error),
          resident: resident.size,
          pinned: pins.size,
        }));
        throw error;
      } finally {
        if (abortListener) signal?.removeEventListener('abort', abortListener);
        fetches.delete(key);
      }
    });
    state.pending = operation.catch(() => {});
    return operation;
  };
}
