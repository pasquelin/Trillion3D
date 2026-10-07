import { corruptObject } from '../cluster/pages.ts'
import { checked, ONE_REQUEST, retriableError } from '../cluster/checked.ts'
import { verifyPageBytes } from '../page/work/host.ts'
import type { StreamContext, StreamPage } from './types.ts'
import { createRoundTrip } from './roundTrip.ts'

/** How many times a page read is tried before it fails. */
export const PAGE_FETCH_ATTEMPTS = 3

/** One read attempt of page `url`: its number, the signal that cancels it, and when it started —
 *  diagnostics only. */
type Attempt = {
  url: string
  page: StreamPage
  attempt: number
  signal: AbortSignal
  start: number
}

/** Says `phase` of attempt `at` to a listener: its version, page and number, then `detail`. */
const note = (
  emit: StreamContext['emit'],
  { url, attempt }: Attempt,
  phase: string,
  message: string,
  detail: () => Record<string, unknown> = () => ({}),
) => emit?.(phase, message, () => ({ version: 1, url, attempt, ...detail() }))

/** What an attempt lasted, for a listener alone. */
const lasted = ({ onDiagnostic }: StreamContext, { start }: Attempt) =>
  onDiagnostic ? performance.now() - start : null

/** Checks an attempt's `buffer`, `byteLength` long, against its page — the size, then the
 *  digest —; a mismatch is thrown, named by what failed: the retries and the final
 *  `PAGE_STREAM_FAILED` repeat it. */
async function verifyRead(
  emit: StreamContext['emit'],
  at: Attempt,
  buffer: ArrayBuffer,
  byteLength: number,
) {
  const { url, page } = at
  const sizeMatches = byteLength === page.bytes
  let actualHash: string | undefined
  if (sizeMatches) actualHash = await verifyPageBytes(buffer)
  const hashMatches = sizeMatches && actualHash === page.sha256
  const verdict = hashMatches ? 'Page hash and size verified' : 'Page verification failed'
  note(emit, at, 'page-hash-check', verdict, () => ({
    expectedBytes: page.bytes,
    actualBytes: byteLength,
    expectedHash: page.sha256,
    actualHash: actualHash ?? null,
    sizeMatches,
    hashMatches,
  }))
  if (!hashMatches) {
    note(emit, at, 'page-corruption', 'Corrupt page or unexpected size')
    throw corruptObject(url, page, byteLength, actualHash)
  }
}

/** One attempt: one request — the loop of `loadOne` is the retry, and it says so page by page —,
 *  its bytes verified, then kept (`touch`) and counted. */
async function readAttempt(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array, sha256: string) => void,
  roundTrip: ReturnType<typeof createRoundTrip>,
  at: Attempt,
) {
  const { base, emit, state, cache } = context,
    { url, page, signal } = at
  note(emit, at, 'page-read-start', 'Page read started', () => ({ expectedBytes: page.bytes }))
  // Its round trip runs until the page's bytes have landed: what a page asked for ahead has to
  // cover.
  const sent = performance.now()
  const buffer = await (await checked(new URL(url, base).href, signal, ONE_REQUEST)).arrayBuffer()
  roundTrip.note(performance.now() - sent)
  // Size is taken before the digest: the cheaper refusal first.
  const byteLength = buffer.byteLength
  note(emit, at, 'page-read-end', 'Page read finished', () => ({
    actualBytes: byteLength,
    expectedBytes: page.bytes,
    durationMs: lasted(context, at),
  }))
  signal.throwIfAborted()
  await verifyRead(emit, at, buffer, byteLength)
  signal.throwIfAborted()
  const array = new Uint8Array(buffer)
  touch(url, array, page.sha256)
  state.bytesRead += byteLength
  state.loaded++
  note(emit, at, 'page-attempt-end', 'Page read attempt succeeded', () => ({
    actualBytes: byteLength,
    durationMs: lasted(context, at),
    resident: cache.size,
  }))
  return array
}

/** Says an attempt failed with `error`. */
function attemptFailed(context: StreamContext, at: Attempt, error: unknown) {
  note(context.emit, at, 'page-attempt-end', 'Page read attempt failed', () => ({
    error: String(error),
    durationMs: lasted(context, at),
  }))
}

/** Says another attempt follows one that failed with `error`. */
const retrying = ({ emit }: StreamContext, at: Attempt, error: unknown) =>
  note(emit, at, 'page-retry', 'Retry after a read failure', () => ({
    nextAttempt: at.attempt + 1,
    error: String(error),
  }))

/** The persistent failure of page `url` after `tried` attempts, kept in `failures` and said. */
function pageFailed({ failures, emit }: StreamContext, url: string, tried: number, cause: unknown) {
  const times = tried === 1 ? 'one attempt' : `${tried} attempts`
  const error = new Error(`PAGE_STREAM_FAILED: ${url} after ${times}: ${String(cause)}`, {
    cause,
  })
  failures.set(url, error)
  emit?.('page-error', 'Persistent page-load failure', () => ({
    version: 1,
    url,
    attempts: tried,
    error: String(cause),
    sticky: true,
  }))
  return error
}

export function createStreamingFetcher(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array, sha256: string) => void,
) {
  const { catalog, abort, onDiagnostic, emit } = context
  /** The reads' round trip, what the view ahead adds to its horizon (`roundTrip.ts`). */
  const roundTrip = createRoundTrip()
  const loadOne = async (url: string, jobSignal: AbortSignal) => {
    const page = catalog.get(url)
    if (!page) throw new Error('Unknown page ' + url)
    const signal = AbortSignal.any([abort.signal, jobSignal])
    let cause: unknown,
      tried = 0
    for (let attempt = 1; attempt <= PAGE_FETCH_ATTEMPTS; attempt++) {
      signal.throwIfAborted()
      const at = { url, page, attempt, signal, start: onDiagnostic ? performance.now() : 0 }
      note(emit, at, 'page-attempt-start', 'Page read attempt', () => ({
        maxAttempts: PAGE_FETCH_ATTEMPTS,
        expectedBytes: page.bytes,
      }))
      try {
        return await readAttempt(context, touch, roundTrip, at)
      } catch (error) {
        attemptFailed(context, at, error)
        signal.throwIfAborted()
        ;[cause, tried] = [error, attempt]
        // A refusal another request would meet again (a 4xx) is not asked twice (`checked`).
        if (!retriableError(error)) break
        if (attempt < PAGE_FETCH_ATTEMPTS) retrying(context, at, error)
      }
    }
    throw pageFailed(context, url, tried, cause)
  }
  return { loadOne, roundTrip }
}
