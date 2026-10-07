/**
 * WHEN A READ THAT FAILED IS ASKED AGAIN — the one failure policy, the read layer's. A read that
 * may pass (`retriableError`: the network, a timeout, a rate limit, a server error, an answer that
 * is not what its page announced) waits 0.5 s · 2^(k−1) after its k-th failure in a row, at most
 * 8 s, then its job is queued again (`requeue`): its askers keep waiting on it, never told it
 * failed, and one that lets it go drops it as it would a queued one. One another request would
 * meet again — a 404, a 403 — fails its job for good and is refused at once, no request sent, while
 * its page is catalogued. A failure is said once (`onStalled`) when for good or as it first waits
 * the longest. A source refusing every read of F pages is asked at most F times in the first half
 * second, then ever more seldom, down to F every 8 s — never once a frame.
 *
 * The waits are one heap on their end (`heap.ts`) and one timer, set for the first: no timer and
 * no listener per failure. A failure outlives its page while its wait runs — a page admitted again
 * meanwhile still waits it out — and leaves once its wait ended, or at once when for good.
 */
import { retriableError } from '../cluster/checked.ts'
import { createHeap } from './heap.ts'
import type { Job, PageStreamerOptions, StreamPage } from './types.ts'

const FIRST_WAIT_MS = 500,
  LAST_WAIT_MS = 8000

/** A page's failures in a row: the last one's error, how many, when its wait ends — `Infinity`
 *  for good —, and its place in the waits' heap, −1 out of it. */
type ReadFailure = { url: string; error: Error; tries: number; due: number; slot: number }

/** What the failures read of their streamer: its jobs and catalogue, and who hears a stall. */
type Reads = {
  jobs: ReadonlyMap<string, Job>
  catalog: ReadonlyMap<string, StreamPage>
  onStalled?: PageStreamerOptions['onStalled']
}

/** The wait after the `tries`-th failure in a row of a read that may pass. */
const waitAfter = (tries: number) =>
  tries ? Math.min(LAST_WAIT_MS, FIRST_WAIT_MS * 2 ** (tries - 1)) : 0

/** The failures of `reads`' pages, a job whose wait ended queued again by `requeue`. */
export function createReadFailures(reads: Reads, requeue: (job: Job) => void) {
  const failures = new Map<string, ReadFailure>()
  const waits = createHeap<ReadFailure>(
    (a, b) => a.due < b.due,
    (failure, at) => (failure.slot = at),
  )
  let timer: ReturnType<typeof setTimeout> | undefined,
    armed = Infinity,
    final = 0
  /** The one timer, set for the first wait to end. */
  const arm = () => {
    const due = waits.items[0]?.due ?? Infinity
    if (due === armed) return
    clearTimeout(timer)
    armed = due
    if (due < Infinity) timer = setTimeout(wake, Math.max(0, due - performance.now()))
  }
  /** The waits over now end: a job waiting is queued again, a failure whose page left leaves. */
  const wake = () => {
    armed = Infinity
    const now = performance.now()
    while (waits.size && waits.items[0].due <= now) {
      const failure = waits.take()!,
        { url } = failure
      failure.slot = -1
      const job = reads.jobs.get(url)
      if (job?.state === 'waiting') requeue(job)
      else if (!reads.catalog.has(url)) failures.delete(url)
    }
    arm()
  }
  /** `failure` leaves: out of the waits, or out of the count of those for good. */
  const remove = (failure: ReadFailure) => {
    if (failure.slot >= 0) waits.take(failure.slot)
    if (failure.due === Infinity) final--
    failures.delete(failure.url)
  }
  return {
    /** `url`'s read failed by `cause`: the error its job fails with, and whether it waits — queued
     *  again once its wait ends — rather than failing for good. */
    record(url: string, cause: unknown) {
      const failure = failures.get(url) ?? { url, error: new Error(), tries: 0, due: 0, slot: -1 }
      const tries = ++failure.tries,
        times = tries === 1 ? 'one attempt' : `${tries} attempts`
      const retried = retriableError(cause),
        wait = retried ? waitAfter(tries) : Infinity
      failure.error = new Error(`PAGE_STREAM_FAILED: ${url} after ${times}: ${String(cause)}`, {
        cause,
      })
      failure.due = performance.now() + wait
      failures.set(url, failure)
      if (!retried) {
        final++
        if (failure.slot >= 0) waits.take(failure.slot)
        failure.slot = -1
      } else if (failure.slot >= 0) waits.settle(failure.slot)
      else waits.push(failure)
      arm()
      if (wait >= LAST_WAIT_MS && waitAfter(tries - 1) < LAST_WAIT_MS)
        reads.onStalled?.({ url, cause })
      return { error: failure.error, waits: retried }
    },
    /** `url` was read: its failures in a row are over. */
    passed(url: string) {
      const failure = failures.get(url)
      if (failure) remove(failure)
    },
    /** The error a read of `url` is refused with for good, if it is. */
    refusal(url: string) {
      const failure = failures.get(url)
      return failure?.due === Infinity ? failure.error : undefined
    },
    /** Whether `url` waits its turn now: a job made for it waits too. */
    waiting: (url: string) => (failures.get(url)?.slot ?? -1) >= 0,
    /** `url` left the catalogue: its failure leaves, unless its wait runs (`wake`). */
    leaves(url: string) {
      const failure = failures.get(url)
      if (failure && failure.slot < 0) remove(failure)
    },
    /** Reads that failed and do not pass now: waiting their turn, or refused for good. */
    count: () => waits.size + final,
    clear() {
      clearTimeout(timer)
      armed = Infinity
      failures.clear()
      waits.clear()
      final = 0
    },
  }
}

export type ReadFailures = ReturnType<typeof createReadFailures>
