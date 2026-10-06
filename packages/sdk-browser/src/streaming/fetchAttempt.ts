/**
 * ONE ATTEMPT AT A STREAMED PAGE: one request of its bytes — its file, or its range of another
 * (`StreamPage.range`, one reader a file) —, checked against what it announced, counted, and a
 * whole page kept in the cache, each step told to the diagnostics that listen.
 */
import { corruptObject } from '../cluster/pages.ts'
import { checked, ONE_REQUEST } from '../cluster/checked.ts'
import { rangedReader } from '../cluster/ranged.ts'
import { verifyPageBytes } from '../page/decode/host.ts'
import type { StreamContext, StreamPage } from './types.ts'
import { createRoundTrip } from './roundTrip.ts'

/** The attempts a page's read makes before it fails and waits its turn (`failures.ts`). */
export const ATTEMPTS = 3

/** `buffer` checked against what `page` announced, its size then its fingerprint — a range's part
 *  by part —: the bytes to keep, or the fingerprint found when they are not those announced
 *  (`undefined` when the size differs already). The fingerprint of a whole page transfers its
 *  buffer to a decode worker and back: the one returned is the one to read. */
async function verified(page: StreamPage, buffer: ArrayBuffer) {
  if (buffer.byteLength !== page.bytes) return { found: undefined }
  if (!page.range) {
    const { sha256, source } = await verifyPageBytes(buffer)
    return sha256 === page.sha256 ? { buffer: source } : { found: sha256 }
  }
  let at = 0
  for (const part of page.range.parts) {
    const { sha256 } = await verifyPageBytes(buffer.slice(at, (at += part.bytes)))
    if (sha256 !== part.sha256) return { found: sha256 }
  }
  return { buffer }
}

/** The attempts of `context`'s reads, a whole page's bytes kept through `touch`. */
/** `buffer`, `page`'s bytes read at attempt `n` of `url`, checked against what it announced, the
 *  check told: the bytes to keep, or refused by `corruptObject`. */
async function checkedBytes(
  { emit }: StreamContext,
  page: StreamPage,
  url: string,
  n: number,
  buffer: ArrayBuffer,
) {
  const actualBytes = buffer.byteLength,
    expectedBytes = page.bytes
  const { buffer: kept, found } = await verified(page, buffer)
  const sizeMatches = actualBytes === page.bytes,
    hashMatches = kept !== undefined
  emit?.(
    'page-hash-check',
    hashMatches ? 'Page hash and size verified' : 'Page verification failed',
    () => ({
      ...{ version: 1, url, attempt: n, expectedBytes, actualBytes },
      ...{ expectedHash: page.sha256, actualHash: found ?? null, sizeMatches, hashMatches },
    }),
  )
  if (kept) return kept
  emit?.('page-corruption', 'Corrupt page or unexpected size', () => ({
    version: 1,
    url,
    attempt: n,
  }))
  // Named by what failed: the retries and the final `PAGE_STREAM_FAILED` repeat it.
  throw corruptObject(url, page, actualBytes, found)
}

/** The requests of pages under `base`: a page's file, or its range of another, read through one
 *  reader a file — a server that ignores the Range answers it whole, kept and read no more
 *  (`rangedReader`). */
function createPageRequests(base: string) {
  const files = new Map<string, ReturnType<typeof rangedReader>>()
  return {
    /** One request of `page`'s bytes. */
    async request(page: StreamPage, url: string, signal: AbortSignal) {
      if (!page.range)
        return (await checked(new URL(url, base).href, signal, ONE_REQUEST)).arrayBuffer()
      const file = new URL(page.range.file, base).href
      let read = files.get(file)
      if (!read) files.set(file, (read = rangedReader(file)))
      return read(page.range.offset, page.bytes, { attempts: ONE_REQUEST, signal })
    },
    /** The bytes of the files kept whole for servers that ignore the Range. */
    keptBytes() {
      let kept = 0
      for (const read of files.values()) kept += read.held()
      return kept
    },
  }
}

/** The attempts of `context`'s reads, a whole page's bytes kept through `touch`. */
export function createPageAttempt(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array, sha256: string) => void,
) {
  const { base, onDiagnostic, emit, state } = context
  /** The reads' round trip, what the view ahead adds to its horizon (`roundTrip.ts`). */
  const roundTrip = createRoundTrip()
  const { request, keptBytes } = createPageRequests(base)
  /** One attempt at `page`: its bytes read, checked and counted, a whole page kept in the cache. */
  const attempt = async (page: StreamPage, url: string, signal: AbortSignal, n: number) => {
    const started = onDiagnostic ? performance.now() : 0,
      expectedBytes = page.bytes
    emit?.('page-attempt-start', 'Page read attempt', () => ({
      ...{ version: 1, url, attempt: n, maxAttempts: ATTEMPTS, expectedBytes },
    }))
    emit?.('page-read-start', 'Page read started', () => ({
      version: 1,
      url,
      attempt: n,
      expectedBytes,
    }))
    // One request per attempt: `loadOne` is the retry, and it says so page by page. Its round trip
    // runs until the page's bytes have landed: what a page asked for ahead has to cover.
    const sent = performance.now()
    const buffer = await request(page, url, signal)
    roundTrip.note(performance.now() - sent)
    // The size is taken before the fingerprint, which detaches the buffer for the round trip.
    const actualBytes = buffer.byteLength
    const durationMs = () => (onDiagnostic ? performance.now() - started : null)
    emit?.('page-read-end', 'Page read finished', () => ({
      ...{ version: 1, url, attempt: n, actualBytes, expectedBytes, durationMs: durationMs() },
    }))
    signal.throwIfAborted()
    const array = new Uint8Array(await checkedBytes(context, page, url, n, buffer))
    signal.throwIfAborted()
    if (!page.range) touch(url, array, page.sha256)
    state.bytesRead += actualBytes
    state.loaded++
    emit?.('page-attempt-end', 'Page read attempt succeeded', () => ({
      ...{ version: 1, url, attempt: n, actualBytes, durationMs: durationMs() },
      resident: context.cache.size,
    }))
    return array
  }
  return { attempt, roundTrip, keptBytes }
}
