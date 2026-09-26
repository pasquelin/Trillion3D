import { EngineError } from '../../../sdk-core/src/index.ts';
import { verifyPageBytes } from '../page/decode/host.ts';
/** Whether a failure of HTTP `status` a second request may not meet: the network (`null`), or a
 *  server error (5xx). A refusal another request would meet again — a 4xx — is not. */
export const retriable = (status: number | null) => status === null || status >= 500;
/** The HTTP status `error` was refused with (`checked`), `null` for none: the network, or an
 *  error of another kind. */
export const refusedStatus = (error: unknown) => {
  const status = error instanceof EngineError ? error.details.status : null;
  return typeof status === 'number' ? status : null;
};
/** A refused answer's body let go at once, not left to hold its connection until collected. */
const letGo = (response: Response) => void response.body?.cancel().catch(() => {});
/** What an optional file's absence answers: a 404, or the 403 of a store that hides what it lacks. */
const ABSENT = new Set([403, 404]);

/** How `checked` reads: `attempts`, the most requests it makes; `optional`, a file that may be
 *  absent, whose 404 or 403 answers `null`. */
export type FetchPolicy = { attempts?: number; optional?: boolean };
/** The policy of a caller that retries on its own terms — the page streamer, the GPU page cache,
 *  the physics tiles: one request. */
export const ONE_REQUEST = { attempts: 1 } as const;

/**
 * Reads `url`, asking once more when the first request fails on the network or on a server error
 * (a 5xx such as a busy server's 503); a refusal another request would meet again — a 404, a 403 —
 * is not asked twice. What still fails is refused by an `EngineError` naming the address, but for
 * the absence of an `optional` file (`ABSENT`), which answers `null`. An aborted `signal` rejects
 * with its reason and asks nothing more. The SDK guide states this policy (docs/SDK.md).
 */
export function checked(
  url: string,
  signal?: AbortSignal,
  policy?: FetchPolicy & { optional?: false },
): Promise<Response>;
export function checked(
  url: string,
  signal: AbortSignal | undefined,
  policy: FetchPolicy & { optional: true },
): Promise<Response | null>;
export async function checked(
  url: string,
  signal?: AbortSignal,
  { attempts = 2, optional = false }: FetchPolicy = {},
) {
  let response: Response | undefined, cause: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      signal?.throwIfAborted();
      [response, cause] = [undefined, error];
    }
    if (response && !retriable(response.status)) break;
    if (attempt < attempts && response) letGo(response);
  }
  // A network failure is the same refusal as an HTTP one, with no status to give.
  if (!response)
    throw new EngineError(
      'RESOURCE_HTTP_ERROR',
      `${url}: ${String(cause)} (${attempts === 1 ? 'one request' : `${attempts} requests`})`,
      {
        url,
        status: null,
        contentType: null,
      },
    );
  if (response.ok) return response;
  letGo(response);
  if (optional && ABSENT.has(response.status)) return null;
  const contentType = response.headers.get('content-type');
  throw new EngineError(
    'RESOURCE_HTTP_ERROR',
    `${url}: HTTP ${response.status}, type ${contentType ?? 'absent'}`,
    { url, status: response.status, contentType },
  );
}
/** A cache object that is not what its manifest announced: its code and facts, whichever it is. */
export const corruptObject = (
  url: string,
  announced: { bytes: number; sha256: string },
  bytes: number,
  sha256: string | undefined,
) =>
  new EngineError(
    'INVALID_CACHE',
    sha256 !== undefined
      ? `Corrupt cache object: SHA-256 ${sha256}, ${announced.sha256} announced`
      : `Corrupt cache object: ${bytes} bytes received, ${announced.bytes} announced`,
    {
      url,
      bytes,
      expected: announced.bytes,
      sha256: sha256 ?? null,
      expectedSha256: announced.sha256,
    },
  );

/**
 * Reads the cache object at `url` (`checked`) and hands its bytes back only when they are the ones
 * its manifest `announced`, size then fingerprint; `corruptObject` otherwise. The size is taken
 * before the fingerprint, which transfers the buffer to a decode worker and back.
 */
export async function fetchVerified(
  url: string,
  announced: { bytes: number; sha256: string },
  signal?: AbortSignal,
) {
  const buffer = await (await checked(url, signal)).arrayBuffer();
  const bytes = buffer.byteLength;
  signal?.throwIfAborted();
  if (bytes !== announced.bytes) throw corruptObject(url, announced, bytes, undefined);
  const verified = await verifyPageBytes(buffer);
  if (verified.sha256 !== announced.sha256)
    throw corruptObject(url, announced, bytes, verified.sha256);
  return verified.source;
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
        const buffer = await fetchVerified(new URL(page.url, base).href, page, combined);
        indices.set(page.url, new Uint32Array(buffer));
        pageBytesRead += buffer.byteLength;
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
