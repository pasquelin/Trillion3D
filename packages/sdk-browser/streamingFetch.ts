import { checked } from './clusterPages.ts';
import type { StreamContext } from './streamingTypes.ts';

const digest = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

export function createStreamingFetcher(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array) => void,
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
      emit('page-attempt-start', 'Tentative de lecture de page', () => ({
        version: 1,
        url,
        attempt,
        maxAttempts: 3,
        expectedBytes: page.bytes,
      }));
      try {
        emit('page-read-start', 'Lecture de page démarrée', () => ({
          version: 1,
          url,
          attempt,
          expectedBytes: page.bytes,
        }));
        const bytes = await (await checked(new URL(url, base).href, combined)).arrayBuffer();
        emit('page-read-end', 'Lecture de page terminée', () => ({
          version: 1,
          url,
          attempt,
          actualBytes: bytes.byteLength,
          expectedBytes: page.bytes,
          durationMs: onDiagnostic ? performance.now() - attemptStart : null,
        }));
        combined.throwIfAborted();
        const sizeMatches = bytes.byteLength === page.bytes;
        const actualHash = sizeMatches ? await digest(bytes) : undefined;
        const hashMatches = sizeMatches && actualHash === page.sha256;
        emit(
          'page-hash-check',
          hashMatches ? 'Hash et taille de page vérifiés' : 'Échec de vérification de page',
          () => ({
            version: 1,
            url,
            attempt,
            expectedBytes: page.bytes,
            actualBytes: bytes.byteLength,
            expectedHash: page.sha256,
            actualHash: actualHash ?? null,
            sizeMatches,
            hashMatches,
          }),
        );
        if (!hashMatches) {
          emit('page-corruption', 'Page corrompue ou de taille inattendue', () => ({
            version: 1,
            url,
            attempt,
          }));
          throw new Error('Corrupt cluster page');
        }
        combined.throwIfAborted();
        const array = new Uint8Array(bytes);
        touch(url, array);
        state.bytesRead += bytes.byteLength;
        state.loaded++;
        emit('page-attempt-end', 'Tentative de lecture réussie', () => ({
          version: 1,
          url,
          attempt,
          actualBytes: bytes.byteLength,
          durationMs: onDiagnostic ? performance.now() - attemptStart : null,
          resident: cache.size,
        }));
        return array;
      } catch (error) {
        emit('page-attempt-end', 'Tentative de lecture échouée', () => ({
          version: 1,
          url,
          attempt,
          error: String(error),
          durationMs: onDiagnostic ? performance.now() - attemptStart : null,
        }));
        combined.throwIfAborted();
        cause = error;
        if (attempt < 3)
          emit('page-retry', 'Nouvelle tentative après échec de lecture', () => ({
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
    emit('page-error', 'Échec persistant du chargement de page', () => ({
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
