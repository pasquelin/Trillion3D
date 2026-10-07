/**
 * ONE REQUEST OF A TRANSFER: a page's file, or the ranges end to end of one file the queue merged
 * (`queueRanges.ts`), read by one HTTP Range through the one reader of that file the read layer
 * holds for the session (`rangedReader`: a server that ignores the Range answers the whole file,
 * kept and read no more, its bytes counted once, by the cache's reserve). Each page is checked
 * against what it announced (`fetchAttempt.ts`), counted, and kept in the cache unless its askers
 * keep it (`StreamPage.kept`). One request, never retried here: what fails waits its turn
 * (`failures.ts`), and that wait is the retry.
 */
import { checked, ONE_REQUEST } from '../cluster/checked.ts'
import { rangedReader } from '../cluster/ranged.ts'
import type { Job, StreamContext, StreamPage } from './types.ts'
import { createRoundTrip } from './roundTrip.ts'
import { checkedPages } from './fetchAttempt.ts'

/** What a transfer brings each of its jobs: its page's bytes, or what its read failed by. */
export type Landed =
  { bytes: Uint8Array; cause?: undefined } | { bytes?: undefined; cause: unknown }

/** The requests of pages under `base`, one reader a file for the ranges of it. */
function createRequests(base: string) {
  const files = new Map<string, ReturnType<typeof rangedReader>>()
  return {
    /** One request of `pages`: a page's file, or the ranges end to end of one file. */
    async request(pages: readonly StreamPage[], signal: AbortSignal) {
      const [first] = pages,
        last = pages[pages.length - 1]
      if (!first.range)
        return (await checked(new URL(first.url, base).href, signal, ONE_REQUEST)).arrayBuffer()
      const file = new URL(first.range.file, base).href
      let read = files.get(file)
      if (!read) files.set(file, (read = rangedReader(file)))
      const { offset } = first.range,
        bytes = last.range!.offset + last.bytes - offset
      return read(offset, bytes, { attempts: ONE_REQUEST, signal })
    },
    /** The bytes of the files its readers kept whole for servers that ignore the Range. */
    keptBytes() {
      let kept = 0
      for (const read of files.values()) kept += read.held()
      return kept
    },
  }
}

/** The reads of `context`'s transfers (`read`), a page's bytes kept through `touch`. */
export function createStreamingFetcher(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array, sha256: string) => void,
) {
  const { base, catalog, emit, state } = context
  /** The reads' round trip, what the view ahead adds to its horizon (`roundTrip.ts`). */
  const roundTrip = createRoundTrip()
  const { request, keptBytes } = createRequests(base)
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
      buffer = await request(pages, signal)
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
      // A range kept in the cache is its own bytes, never a view holding the whole read.
      if (page.kept !== false)
        touch(page.url, page.range ? own.bytes.slice() : own.bytes, page.sha256)
      state.bytesRead += own.bytes.byteLength
      state.loaded++
      return { bytes: own.bytes }
    })
  }
  return { read, roundTrip, keptBytes }
}
