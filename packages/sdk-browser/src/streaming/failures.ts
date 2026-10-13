/**
 * WHEN A READ THAT FAILED IS ASKED AGAIN — the one failure policy of every read by key: the page
 * streamer's pages, an HTTP page source's (`gpu/page/pages.ts`), and the baked texture levels
 * (`texture/heldLevels.ts`). A read its owner's `retriable` says may pass — the
 * network, a timeout, a rate limit, a server error (`retriableError`) — waits 0.5 s · 2^(k−1) after
 * its k-th failure in a row, at most 8 s — or the longer wait its server asked (`Retry-After`,
 * capped: `retryAfterOf`) —; one another request would meet again — a 404, a 403, a level file
 * whose length is not its own — fails for good and is refused at once, no request sent. While its
 * wait runs, its key is held back (`blocked`): the streamer's job waits, its askers still waiting
 * on it, and is queued again once its wait ends (`ended`); a level is refused until then, asked
 * again by the next frame that wants it. A failure is said once (`onStalled`) when for good or as
 * it first waits the longest, and again only after it passed: the session tells its host
 * (`streamFailed`). A source refusing every read of F keys is asked at most F times in the first
 * half second, then ever more seldom, down to F every 8 s — never once a frame.
 *
 * The waits are one heap on their end (`math/src/sequence/heap.ts`) and one timer, set for the
 * first: no timer and no listener per failure. A failure stays till its key passes, its tries
 * counting on while it is asked again; once its wait ended, it is forgotten 8 s later unless it
 * failed again meanwhile — or at once when its owner lets the key go (`leaves`) —, so the failures
 * held are those of the keys still asked, and those refused for good.
 */
import { retryAfterOf } from '../cluster/checked.ts'
import { createHeap } from '../../../math/src/sequence/heap.ts'

const FIRST_WAIT_MS = 500,
  LAST_WAIT_MS = 8000

/** Where a key's failures in a row stand: its wait runs, no request sent for it (`waiting`); its
 *  wait is over, its key asked again, the failure remembered till it is forgotten (`over`); or it
 *  is refused for good, no request ever sent for it (`refused`). */
type FailureState = 'waiting' | 'over' | 'refused'

/** A key's failures in a row: the last one's error, how many, where they stand, when its wait ends
 *  — or, its wait over, when it is forgotten —, the longest wait they took — said once it reaches
 *  the last (`onStalled`) —, and its place in the waits' heap, −1 out of it. */
type ReadFailure = {
  key: string
  error: Error
  tries: number
  state: FailureState
  due: number
  longest: number
  slot: number
}

/** Why a read of a key is held back now (`blocked`): the error it is refused with, and whether it
 *  waits its turn or is refused for good. */
type Blocked = { readonly error: Error; readonly state: Exclude<FailureState, 'over'> }

/** How the failures are weighed and who hears them: `retriable`, whether a failure may pass;
 *  `ended`, each wait over; `onStalled`, a failure said. */
type FailurePolicy = {
  retriable: (cause: unknown) => boolean
  ended?: (key: string) => void
  onStalled?: (failure: { key: string; cause: unknown }) => void
}

/** The wait after the `tries`-th failure in a row of a read that may pass. */
const waitAfter = (tries: number) =>
  tries ? Math.min(LAST_WAIT_MS, FIRST_WAIT_MS * 2 ** (tries - 1)) : 0

/** The error a read of `key` fails with, its `tries`-th failure in a row by `cause`. */
function failedRead(key: string, tries: number, cause: unknown) {
  const times = tries === 1 ? 'one attempt' : `${tries} attempts`
  return new Error(`PAGE_STREAM_FAILED: ${key} after ${times}: ${String(cause)}`, { cause })
}

/** The failures' due times: one heap on their end and one timer, set for the first; `due` hears
 *  each one over, taken out. */
function createWaits(due: (failure: ReadFailure) => void) {
  const waits = createHeap<ReadFailure>(
    (a, b) => a.due < b.due,
    (failure, at) => (failure.slot = at),
  )
  let timer: ReturnType<typeof setTimeout> | undefined,
    armed = Infinity
  const arm = () => {
    const first = waits.items[0]?.due ?? Infinity
    if (first === armed) return
    clearTimeout(timer)
    armed = first
    if (first < Infinity) timer = setTimeout(wake, Math.max(0, first - performance.now()))
  }
  const wake = () => {
    armed = Infinity
    const now = performance.now()
    while (waits.size && waits.items[0].due <= now) due(take(waits.items[0]))
    arm()
  }
  const take = (failure: ReadFailure) => {
    waits.take(failure.slot)
    failure.slot = -1
    return failure
  }
  return {
    /** `failure` waits till its `due`, or on to its new one. */
    wait(failure: ReadFailure) {
      if (failure.slot >= 0) waits.settle(failure.slot)
      else waits.push(failure)
      arm()
    },
    /** `failure` waits no more. */
    leave: (failure: ReadFailure) => void (failure.slot >= 0 && take(failure)),
    clear() {
      clearTimeout(timer)
      armed = Infinity
      waits.clear()
    },
  }
}

/** A key's first failure in a row, before it is recorded. */
const fresh = (key: string): ReadFailure => ({
  key,
  error: new Error(),
  tries: 0,
  state: 'over',
  due: 0,
  longest: 0,
  slot: -1,
})

/** The failures of reads by key, weighed by `retriable`, each wait over told to `ended`. */
export function createReadFailures({ retriable, ended, onStalled }: FailurePolicy) {
  const failures = new Map<string, ReadFailure>()
  /** How many failures stand in each state. */
  const counts: Record<FailureState, number> = { waiting: 0, over: 0, refused: 0 }
  /** `failure` stands at `state` from now on. */
  const move = (failure: ReadFailure, state: FailureState) => {
    counts[failure.state]--
    counts[state]++
    failure.state = state
  }
  /** `failure` leaves: out of the heap, and out of its count. */
  const remove = (failure: ReadFailure) => {
    waits.leave(failure)
    counts[failure.state]--
    failures.delete(failure.key)
  }
  // A wait over: its key may be asked again, its tries remembered a while; a key not failed again
  // by then is forgotten.
  const waits = createWaits((failure) => {
    if (failure.state !== 'waiting') return remove(failure)
    move(failure, 'over')
    failure.due = performance.now() + LAST_WAIT_MS
    waits.wait(failure)
    ended?.(failure.key)
  })
  return {
    /** `key`'s read failed by `cause`: the error its read fails with, and whether it waits —
     *  asked again once its wait ends — rather than failing for good. */
    record(key: string, cause: unknown) {
      let failure = failures.get(key)
      if (!failure) {
        failures.set(key, (failure = fresh(key)))
        counts.over++
      }
      const tries = ++failure.tries,
        again = retriable(cause),
        wait = again ? Math.max(waitAfter(tries), retryAfterOf(cause)) : Infinity
      failure.error = failedRead(key, tries, cause)
      failure.due = performance.now() + wait
      move(failure, again ? 'waiting' : 'refused')
      if (again) waits.wait(failure)
      else waits.leave(failure)
      if (wait >= LAST_WAIT_MS && failure.longest < LAST_WAIT_MS) onStalled?.({ key, cause })
      failure.longest = Math.max(failure.longest, wait)
      return { error: failure.error, waits: again }
    },
    /** `key` was read: its failures in a row are over. */
    passed(key: string) {
      const failure = failures.get(key)
      if (failure) remove(failure)
    },
    /** Why a read of `key` is held back now — refused for good, or waiting its turn —, if it is:
     *  no request is sent for it. */
    blocked(key: string): Blocked | undefined {
      const failure = failures.get(key)
      return failure?.state === 'over' ? undefined : (failure as Blocked | undefined)
    },
    /** `key` is let go by its owner: its failure leaves, unless its wait runs. */
    leaves(key: string) {
      const failure = failures.get(key)
      if (failure && failure.state !== 'waiting') remove(failure)
    },
    /** Reads that failed and do not pass now: waiting their turn, or refused for good. */
    count: () => counts.waiting + counts.refused,
    clear() {
      waits.clear()
      failures.clear()
      counts.waiting = counts.over = counts.refused = 0
    },
  }
}

export type ReadFailures = ReturnType<typeof createReadFailures>
