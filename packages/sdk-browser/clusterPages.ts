import { EngineError } from '../sdk-core/src/index.ts';
import { verifyPageBytes } from './pageDecodeHost.ts';
export async function checked(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new EngineError(
      'RESOURCE_HTTP_ERROR',
      `${url}: HTTP ${response.status}, type ${response.headers.get('content-type') ?? 'absent'}`,
      { url, status: response.status, contentType: response.headers.get('content-type') },
    );
  return response;
}
export async function loadClusterPages(
  pages: Array<{ url: string; bytes: number; sha256: string }>,
  base: string,
  signal: AbortSignal | undefined,
  progress: (loaded: number, total: number) => void,
  workerCount = 4,
) {
  const indices = new Map<string, Uint32Array>(),
    abort = new AbortController(),
    combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  let next = 0,
    loaded = 0,
    pageBytesRead = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, workerCount), pages.length) },
    async () => {
      while (next < pages.length) {
        combined.throwIfAborted();
        const page = pages[next++];
        let buffer = await (await checked(new URL(page.url, base).href, combined)).arrayBuffer();
        // Size sampled before the fingerprint: the buffer leaves transferred, then comes back transferred.
        const byteLength = buffer.byteLength;
        combined.throwIfAborted();
        if (byteLength !== page.bytes) throw new Error('Corrupt cluster page');
        const verified = await verifyPageBytes(buffer);
        buffer = verified.source;
        if (verified.sha256 !== page.sha256) throw new Error('Corrupt cluster page');
        indices.set(page.url, new Uint32Array(buffer));
        pageBytesRead += byteLength;
        progress(++loaded, pages.length);
      }
    },
  );
  try {
    await Promise.all(workers);
  } catch (error) {
    abort.abort(error instanceof Error ? error : String(error));
    await Promise.all(workers.map((worker) => worker.catch(() => {})));
    throw error;
  }
  return { indices, loaded, pageBytesRead };
}
