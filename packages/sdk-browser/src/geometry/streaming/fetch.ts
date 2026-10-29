/**
 * ONE REQUEST OF A TRANSFER: a page's file, or the ranges end to end of one file the queue merged
 * (`queueRanges.ts`), read by one HTTP Range through the page cache every load and session reads
 * through (`PageCache.readRange`: a server that ignores the Range answers the whole file, kept as
 * one entry of the cache among the pages, evicted as they are). Each page is checked against what
 * it announced (`fetchAttempt.ts`), counted, and kept in the cache unless its askers keep it
 * (`StreamPage.kept`). One request, never retried here: what fails is asked again by the failure
 * policy (`failures.ts`), at once or after the wait its server asked.
 */
import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { checked, ONE_REQUEST } from '../cluster/checked.ts'
import { corruptObject } from '../cluster/verified.ts'
import { inflateRaw } from '../cluster/inflateRaw.ts'
import type { Job, StreamContext, StreamPage } from './types.ts'
import { checkedPages, emitCorruption } from './fetchAttempt.ts'

/** What a transfer brings each of its jobs: its page's bytes, or what its read failed by. */
export type Landed =
  { bytes: Uint8Array; cause?: undefined } | { bytes?: undefined; cause: unknown }

/** One request of `pages` under `base`: a page's file, or the ranges end to end of one file,
 *  read through `store`. */
async function request(
  { base, store }: StreamContext,
  pages: readonly StreamPage[],
  signal: AbortSignal,
) {
  const [first] = pages,
    last = pages[pages.length - 1]
  if (!first.range)
    return (await checked(new URL(first.url, base).href, signal, ONE_REQUEST)).arrayBuffer()
  const { offset } = first.range,
    bytes = last.range!.offset + last.bytes - offset
  const file = new URL(first.range.file, base).href
  return store.readRange(file, offset, bytes, { attempts: ONE_REQUEST, signal })
}

/** `own`, the proven bytes of `page`: inflated when it is stored as raw DEFLATE, refused when
 *  they inflate to other than the size announced (the `INVALID_CACHE` of a failed check). */
async function decoded({ emit }: StreamContext, page: StreamPage, own: Uint8Array) {
  const { url, decodedBytes } = page
  if (decodedBytes === undefined) return own
  const inflated = await inflateRaw(own, decodedBytes).catch(() => undefined)
  if (inflated?.byteLength === decodedBytes) return inflated
  emitCorruption(emit, url)
  if (inflated)
    throw corruptObject(url, { ...page, bytes: decodedBytes }, inflated.byteLength, undefined)
  throw new EngineError(
    'INVALID_CACHE',
    `Corrupt cache object: its raw DEFLATE does not inflate to the ${decodedBytes} bytes announced`,
    { url, bytes: own.byteLength, expected: decodedBytes, sha256: page.sha256 },
  )
}

/** The reads of `context`'s transfers (`read`), a page's bytes kept in its cache. */
export function createStreamingFetcher(context: StreamContext) {
  const { catalog, emit, state, store } = context
  /** The pages of `jobs` read by one request on `signal`: what each job lands with. */
  const read = async (jobs: readonly Job[], signal: AbortSignal): Promise<Landed[]> => {
    const pages = jobs.map((job) => catalog.get(job.url)!)
    for (const { url, bytes } of pages)
      emit?.('page-read-start', 'Page read started', () => ({
        version: 1,
        url,
        expectedBytes: bytes,
      }))
    // Its round trip runs until the pages' bytes have landed.
    const sent = cpuNow()
    let buffer: ArrayBuffer
    try {
      buffer = await request(context, pages, signal)
    } catch (cause) {
      return jobs.map(() => ({ cause }))
    }
    emit?.('page-read-end', 'Page read finished', () => ({
      version: 1,
      url: jobs[0].url,
      pages: jobs.length,
      actualBytes: buffer.byteLength,
      durationMs: msSince(sent),
    }))
    if (signal.aborted) return jobs.map(() => ({ cause: signal.reason }))
    const landed = await checkedPages(context, pages, buffer)
    return Promise.all(
      landed.map(async (own, at): Promise<Landed> => {
        if (!own.bytes) return { cause: own.refused }
        const page = pages[at]
        let bytes: Uint8Array
        try {
          bytes = await decoded(context, page, own.bytes)
        } catch (cause) {
          return { cause }
        }
        // A read dropped while it inflated keeps nothing.
        if (signal.aborted) return { cause: signal.reason }
        // Held under the stored bytes' digest, which names the inflated ones as surely.
        if (page.kept !== false) store.put(page.url, bytes, page.sha256)
        state.bytesRead += own.bytes.byteLength
        state.loaded++
        return { bytes }
      }),
    )
  }
  return { read }
}
