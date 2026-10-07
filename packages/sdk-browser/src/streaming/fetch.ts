/**
 * ONE REQUEST OF A TRANSFER: a page's file, or the ranges end to end of one file the queue merged
 * (`queueRanges.ts`), read by one HTTP Range through the one reader of that file the page cache
 * holds for every load and session (`PageCache.reader`: a server that ignores the Range answers the
 * whole file, kept and read no more, its bytes counted once, beside the pages). Each page is checked
 * against what it announced (`fetchAttempt.ts`), counted, and kept in the cache unless its askers
 * keep it (`StreamPage.kept`). One request, never retried here: what fails waits its turn
 * (`failures.ts`), and that wait is the retry.
 */
import { checked, ONE_REQUEST } from '../cluster/checked.ts'
import type { Job, StreamContext, StreamPage } from './types.ts'
import { createRoundTrip } from './roundTrip.ts'
import { checkedPages } from './fetchAttempt.ts'

/** What a transfer brings each of its jobs: its page's bytes, or what its read failed by. */
export type Landed =
  { bytes: Uint8Array; cause?: undefined } | { bytes?: undefined; cause: unknown }

/** One request of `pages` under `base`: a page's file, or the ranges end to end of one file,
 *  read through `store`'s one reader of that file. */
async function request(
  { base, store }: StreamContext,
  pages: readonly StreamPage[],
  signal: AbortSignal,
) {
  const [first] = pages,
    last = pages[pages.length - 1]
  if (!first.range)
    return (await checked(new URL(first.url, base).href, signal, ONE_REQUEST)).arrayBuffer()
  const read = store.reader(new URL(first.range.file, base).href)
  const { offset } = first.range,
    bytes = last.range!.offset + last.bytes - offset
  return read(offset, bytes, { attempts: ONE_REQUEST, signal })
}

/** The reads of `context`'s transfers (`read`), a page's bytes kept through `touch`. */
export function createStreamingFetcher(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array, sha256: string) => void,
) {
  const { catalog, emit, state } = context
  /** The reads' round trip, what the view ahead adds to its horizon (`roundTrip.ts`). */
  const roundTrip = createRoundTrip()
  /** The pages of `jobs` read by one request on `signal`: what each job lands with. */
  const read = async (jobs: readonly Job[], signal: AbortSignal): Promise<Landed[]> => {
    const pages = jobs.map((job) => catalog.get(job.url)!)
    for (const { url, bytes } of pages)
      emit?.('page-read-start', 'Page read started', () => ({
        version: 1,
        url,
        expectedBytes: bytes,
      }))
    // Its round trip runs until the pages' bytes have landed: what a page asked ahead has to cover.
    const sent = performance.now()
    let buffer: ArrayBuffer
    try {
      buffer = await request(context, pages, signal)
    } catch (cause) {
      return jobs.map(() => ({ cause }))
    }
    const durationMs = performance.now() - sent
    roundTrip.note(durationMs)
    emit?.('page-read-end', 'Page read finished', () => ({
      ...{ version: 1, url: jobs[0].url, pages: jobs.length, actualBytes: buffer.byteLength },
      durationMs,
    }))
    if (signal.aborted) return jobs.map(() => ({ cause: signal.reason }))
    const landed = await checkedPages(context, pages, buffer)
    return landed.map((own, at) => {
      if (!own.bytes) return { cause: own.refused }
      const page = pages[at]
      if (page.kept !== false) touch(page.url, own.bytes, page.sha256)
      state.bytesRead += own.bytes.byteLength
      state.loaded++
      return { bytes: own.bytes }
    })
  }
  return { read, roundTrip }
}
