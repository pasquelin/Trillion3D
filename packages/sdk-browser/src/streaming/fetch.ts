import { checked, corruptObject } from '../cluster/pages.ts';
import { verifyPageBytes } from '../page/decode/host.ts';
import type { StreamContext } from './types.ts';

export function createStreamingFetcher(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array, sha256: string) => void,
) {
  const { catalog, cache, base, abort, onDiagnostic, emit, failures, state } = context;
  const loadOne = async (url: string, jobSignal: AbortSignal) => {
    const page = catalog.get(url);
    if (!page) throw new Error('Unknown page ' + url);
    const combined = AbortSignal.any([abort.signal, jobSignal]);
    let cause: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      combined.throwIfAborted();
      const attemptStart = onDiagnostic ? performance.now() : 0;
      emit('page-attempt-start', 'Page read attempt', () => ({
        version: 1,
        url,
        attempt,
        maxAttempts: 3,
        expectedBytes: page.bytes,
      }));
      try {
        emit('page-read-start', 'Page read started', () => ({
          version: 1,
          url,
          attempt,
          expectedBytes: page.bytes,
        }));
        // One request per attempt: this loop is the retry, and it says so page by page.
        let buffer = await (await checked(new URL(url, base).href, combined, 1)).arrayBuffer();
        // Size is taken before any verification: the buffer leaves transferred to the decode
        // worker, so the original reference is detached for the round trip.
        const byteLength = buffer.byteLength;
        emit('page-read-end', 'Page read finished', () => ({
          version: 1,
          url,
          attempt,
          actualBytes: byteLength,
          expectedBytes: page.bytes,
          durationMs: onDiagnostic ? performance.now() - attemptStart : null,
        }));
        combined.throwIfAborted();
        const sizeMatches = byteLength === page.bytes;
        let actualHash: string | undefined;
        if (sizeMatches) {
          const verified = await verifyPageBytes(buffer);
          actualHash = verified.sha256;
          buffer = verified.source;
        }
        const hashMatches = sizeMatches && actualHash === page.sha256;
        emit(
          'page-hash-check',
          hashMatches ? 'Page hash and size verified' : 'Page verification failed',
          () => ({
            version: 1,
            url,
            attempt,
            expectedBytes: page.bytes,
            actualBytes: byteLength,
            expectedHash: page.sha256,
            actualHash: actualHash ?? null,
            sizeMatches,
            hashMatches,
          }),
        );
        if (!hashMatches) {
          emit('page-corruption', 'Corrupt page or unexpected size', () => ({
            version: 1,
            url,
            attempt,
          }));
          // Named by what failed: the retries and the final `PAGE_STREAM_FAILED` repeat it.
          throw corruptObject(url, page, byteLength, actualHash);
        }
        combined.throwIfAborted();
        const array = new Uint8Array(buffer);
        touch(url, array, page.sha256);
        state.bytesRead += byteLength;
        state.loaded++;
        emit('page-attempt-end', 'Page read attempt succeeded', () => ({
          version: 1,
          url,
          attempt,
          actualBytes: byteLength,
          durationMs: onDiagnostic ? performance.now() - attemptStart : null,
          resident: cache.size,
        }));
        return array;
      } catch (error) {
        emit('page-attempt-end', 'Page read attempt failed', () => ({
          version: 1,
          url,
          attempt,
          error: String(error),
          durationMs: onDiagnostic ? performance.now() - attemptStart : null,
        }));
        combined.throwIfAborted();
        cause = error;
        if (attempt < 3)
          emit('page-retry', 'Retry after a read failure', () => ({
            version: 1,
            url,
            attempt,
            nextAttempt: attempt + 1,
            error: String(error),
          }));
      }
    }
    const error = new Error('PAGE_STREAM_FAILED: ' + url + ' after 3 attempts: ' + String(cause), {
      cause,
    });
    failures.set(url, error);
    emit('page-error', 'Persistent page-load failure', () => ({
      version: 1,
      url,
      attempts: 3,
      error: String(cause),
      sticky: true,
    }));
    throw error;
  };
  return loadOne;
}
