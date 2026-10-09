/**
 * WHEN A READ THAT FAILED IS ASKED AGAIN — the one failure policy of every read by key: the page
 * streamer's pages, the baked texture levels (`texture/heldLevels.ts`) and the pages of an HTTP page
 * source (`gpu/page/pages.ts`). A read that may pass (`retriableError`: the network, a timeout, a
 * rate limit, a server error, an answer that is not what it announced) waits 0.5 s · 2^(k−1) after
 * its k-th failure in a row, at most 8 s — or the longer wait its server asked (`Retry-After`,
 * capped: `retryAfterOf`) —; one another request would meet again — a 404, a 403, a level file
 * whose length is not its own — fails for good and is refused at once, no request sent. While its
 * wait runs, its key is held back (`blocked`): the streamer's job waits, its askers still waiting
 * on it, and is queued again once its wait ends (`ended`); a level or an HTTP page is refused
 * until then, asked again by the next frame that wants it. A failure is said once (`onStalled`)
 * when for good or as it first waits the longest, and again only after it passed: the session
 * tells its host (`streamFailed`). A source refusing every read of F keys is asked at most F times
 * in the first half second, then ever more seldom, down to F every 8 s — never once a frame.
 *
 * The waits are one heap on their end (`math/src/sequence/heap.ts`) and one timer, set for the
 * first: no timer and no listener per failure. A failure stays till its key passes — its tries
 * count on —, or till its owner lets the key go (`leaves`) once its wait ended.
 */
import { retriableError, retryAfterOf } from '../cluster/checked.ts'
import { createHeap } from '../../../math/src/sequence/heap.ts'

const FIRST_WAIT_MS = 500,
  LAST_WAIT_MS = 8000

/** A key's failures in a row: the last one's error, how many, when its wait ends — `Infinity`
 *  for good —, and its place in the waits' heap, −1 out of it. */
type ReadFailure = {
  key: string
  error: Error
  tries: number
  due: number
  slot: number
  /** Said once (`onStalled`): its failures in a row end only when its key passes. */
  said: boolean
}

/** Who hears the failures: `ended`, each wait over; `onStalled`, a failure said. */
type FailureListeners = {
  ended?: (key: string) => void
  onStalled?: (failure: { url: string; cause: unknown }) => void
}

/** The wait after the `tries`-th failure in a row of a read that may pass. */
const waitAfter = (tries: number) =>
  tries ? Math.min(LAST_WAIT_MS, FIRST_WAIT_MS * 2 ** (tries - 1)) : 0

/** The error a read of `key` fails with, its `tries`-th failure in a row by `cause`. */
function failedRead(key: string, tries: number, cause: unknown) {
  const times = tries === 1 ? 'one attempt' : `${tries} attempts`
  return new Error(`PAGE_STREAM_FAILED: ${key} after ${times}: ${String(cause)}`, { cause })
}

/** The waits of failed reads: one heap on their end and one timer, set for the first; `ended`
 *  hears each wait over, taken out. */
function createWaits(ended: (failure: ReadFailure) => void) {
  const waits = createHeap<ReadFailure>(
    (a, b) => a.due < b.due,
    (failure, at) => (failure.slot = at),
  )
  let timer: ReturnType<typeof setTimeout> | undefined,
    armed = Infinity
  const arm = () => {
    const due = waits.items[0]?.due ?? Infinity
    if (due === armed) return
    clearTimeout(timer)
    armed = due
    if (due < Infinity) timer = setTimeout(wake, Math.max(0, due - performance.now()))
  }
  const wake = () => {
    armed = Infinity
    const now = performance.now()
    while (waits.size && waits.items[0].due <= now) ended(take(waits.items[0]))
    arm()
  }
  const take = (failure: ReadFailure) => {
    waits.take(failure.slot)
    failure.slot = -1
    return failure
  }
  return {
    /** `failure` waits till its `due`, or waits on to its new one. */
    wait(failure: ReadFailure) {
      if (failure.slot >= 0) waits.settle(failure.slot)
      else waits.push(failure)
      arm()
    },
    /** `failure` waits no more. */
    leave: (failure: ReadFailure) => void (failure.slot >= 0 && take(failure)),
    get size() {
      return waits.size
    },
    clear() {
      clearTimeout(timer)
      armed = Infinity
      waits.clear()
    },
  }
}

/** A key's first failure in a row, before it is recorded. */
const fresh = (key: string): ReadFailure => {
  return { key, error: new Error(), tries: 0, due: 0, slot: -1, said: false }
}

/** The failures of reads by key, each wait over told to `ended`. */
export function createReadFailures({ ended, onStalled }: FailureListeners = {}) {
  const failures = new Map<string, ReadFailure>()
  let final = 0
  const waits = createWaits(({ key }) => ended?.(key))
  /** `failure` leaves: out of the waits, or out of the count of those for good. */
  const remove = (failure: ReadFailure) => {
    waits.leave(failure)
    if (failure.due === Infinity) final--
    failures.delete(failure.key)
  }
  return {
    /** `key`'s read failed by `cause`, `retried` unless another request would meet it again: the
     *  error its read fails with, and whether it waits — asked again once its wait ends — rather
     *  than failing for good. */
    record(key: string, cause: unknown, retried = retriableError(cause)) {
      const failure = failures.get(key) ?? fresh(key)
      const tries = ++failure.tries,
        wait = retried ? Math.max(waitAfter(tries), retryAfterOf(cause)) : Infinity
      failure.error = failedRead(key, tries, cause)
      failure.due = performance.now() + wait
      failures.set(key, failure)
      if (retried) waits.wait(failure)
      else {
        final++
        waits.leave(failure)
      }
      if (wait >= LAST_WAIT_MS && !failure.said) {
        failure.said = true
        onStalled?.({ url: key, cause })
      }
      return { error: failure.error, waits: retried }
    },
    /** `key` was read: its failures in a row are over. */
    passed: (key: string) => void (failures.has(key) && remove(failures.get(key)!)),
    /** The error a read of `key` is refused with for good, if it is. */
    refusal(key: string) {
      const failure = failures.get(key)
      return failure?.due === Infinity ? failure.error : undefined
    },
    /** Whether `key` waits its turn now: a job made for it waits too. */
    waiting: (key: string) => (failures.get(key)?.slot ?? -1) >= 0,
    /** The error a read of `key` is held back by now — refused for good, or waiting its turn —,
     *  if it is: no request is sent for it. */
    blocked(key: string) {
      const failure = failures.get(key)
      return failure && (failure.due === Infinity || failure.slot >= 0) ? failure.error : undefined
    },
    /** `key` is let go by its owner: its failure leaves, unless its wait runs. */
    leaves(key: string) {
      const failure = failures.get(key)
      if (failure && failure.slot < 0) remove(failure)
    },
    /** Reads that failed and do not pass now: waiting their turn, or refused for good. */
    count: () => waits.size + final,
    clear() {
      waits.clear()
      failures.clear()
      final = 0
    },
  }
}

export type ReadFailures = ReturnType<typeof createReadFailures>
