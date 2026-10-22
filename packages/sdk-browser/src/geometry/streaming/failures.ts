/**
 * WHEN A READ THAT FAILED IS ASKED AGAIN — the one failure policy of every read by key: the page
 * streamer's pages, and the baked texture levels (`materials/texture/heldLevels.ts`). A read its
 * owner's `retriable` says may pass — the network, a timeout, a rate limit, a server error
 * (`retriableError`) — is asked again at once, by the next turn of the loop, with no wait in
 * between, as many times as its owner's `retries` allow (`streamingNumRetries`, none beyond the
 * settings' limit: a negative count, or none given, tries without end); a wait only where its
 * server asked one (`Retry-After`, capped: `retryAfterOf`). One another request would meet again —
 * a 404, a 403, a level file whose length is not its own — or one that failed past its tries fails
 * for good: its key is given up and refused at once, no request ever sent for it, and the object
 * it belongs to (`objectOf`) is invalid: every key of that object is refused too, the ones waiting
 * included, none asked again for as long as the registry lives. While a wait the server asked
 * runs, its key is held back (`blocked`): the streamer's job waits, its askers still waiting on
 * it, and is queued again once its wait ends (`ended`); a level is refused until then, asked again
 * by the next frame that wants it. A failure is said (`onStalled`) at its first failure in a row
 * and when its key is given up, and again only after the key passed: the session tells its host
 * (`streamFailed`).
 *
 * The waits are one heap on their end (`math/src/sequence/heap.ts`) and one timer, set for the
 * first: no timer and no listener per failure. A failure stays, its tries counting on while its
 * key is asked again, till the key passes (`passed`), its owner lets it go (`leaves`) or the
 * registry is cleared.
 */
import { cpuNow } from '../../diagnostic/stopwatch.ts'
import { retryAfterOf } from '../cluster/checked.ts'
import { createHeap } from '../../../../math/src/sequence/heap.ts'

/** Where a key's failures in a row stand: the wait its server asked runs, no request sent for it
 *  (`waiting`); no wait runs, its key asked again, the failure remembered till it passes (`over`);
 *  or it is refused for good, no request ever sent for it (`refused`). */
type FailureState = 'waiting' | 'over' | 'refused'

/** A key's failures in a row: the last one's error, how many, where they stand, when its wait ends,
 *  and its place in the waits' heap, −1 out of it. */
type ReadFailure = {
  key: string
  error: Error
  tries: number
  state: FailureState
  due: number
  slot: number
}

/** Why a read of a key is held back now (`blocked`): the error it is refused with, and whether it
 *  waits its turn or is refused for good. */
type Blocked = { readonly error: Error; readonly state: Exclude<FailureState, 'over'> }

/** How the failures are weighed and who hears them: `retriable`, whether a failure may pass;
 *  `retries`, how many times a read that failed is tried again before its key is given up, read at
 *  each failure — negative, or absent: without end —; `objectOf`, the object a key belongs to, the
 *  one a key given up makes invalid, if the keys belong to objects; `ended`, each wait over;
 *  `onStalled`, a failure said. */
type FailurePolicy = {
  retriable: (cause: unknown) => boolean
  retries?: () => number
  objectOf?: (key: string) => number | undefined
  ended?: (key: string) => void
  onStalled?: (failure: { key: string; cause: unknown }) => void
}

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
    if (first < Infinity) timer = setTimeout(wake, Math.max(0, first - cpuNow()))
  }
  const wake = () => {
    armed = Infinity
    const now = cpuNow()
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
  slot: -1,
})

/** What follows a read's `tries`-th failure in a row, by `cause`: whether it is tried again — the
 *  cause may pass, and the tries are within what the policy allows (negative, or absent: without
 *  end) — and the wait before it: the one its server asked, none else, and none ever when it is
 *  not tried again. */
function nextWait(policy: FailurePolicy, cause: unknown, tries: number) {
  const allowed = policy.retries?.() ?? -1
  const again = policy.retriable(cause) && (allowed < 0 || tries <= allowed)
  return { again, wait: again ? retryAfterOf(cause) : Infinity }
}

/** How many failures stand in each state, and the moves of a failure between them. */
function createStateCounts() {
  const counts: Record<FailureState, number> = { waiting: 0, over: 0, refused: 0 }
  return {
    /** A failure recorded for the first time stands `over`. */
    add: () => void counts.over++,
    /** `failure` stands at `state` from now on. */
    move(failure: ReadFailure, state: FailureState) {
      counts[failure.state]--
      counts[state]++
      failure.state = state
    },
    /** `failure` leaves its count. */
    drop: (failure: ReadFailure) => void counts[failure.state]--,
    /** Reads that failed and do not pass now: waiting their turn, or refused for good. */
    stalled: () => counts.waiting + counts.refused,
    reset() {
      counts.waiting = counts.over = counts.refused = 0
    },
  }
}

/** The objects a key was given up for (`objectOf`): why each is refused, every key it owns with it. */
function createInvalidObjects(objectOf: FailurePolicy['objectOf']) {
  const invalid = new Map<number, Blocked>()
  return {
    /** `key` is given up for `error`: its object, if it has one, is invalid from now on. */
    giveUp(key: string, error: Error) {
      const object = objectOf?.(key)
      if (object !== undefined && !invalid.has(object))
        invalid.set(object, { error, state: 'refused' })
    },
    /** Why `key` is refused because its object is invalid, if it is. */
    of(key: string) {
      const object = objectOf?.(key)
      return object === undefined ? undefined : invalid.get(object)
    },
    clear: () => invalid.clear(),
  }
}

/** The failures of reads by key, weighed by `retriable` and `retries`, each wait over told to
 *  `ended`. */
export function createReadFailures(policy: FailurePolicy) {
  const failures = new Map<string, ReadFailure>()
  const objects = createInvalidObjects(policy.objectOf)
  const counts = createStateCounts()
  /** `key`'s failure leaves, out of the heap and out of its count — one whose wait runs stays, when
   *  `keepWaiting`. */
  const leave = (key: string, keepWaiting: boolean) => {
    const failure = failures.get(key)
    if (!failure || (keepWaiting && failure.state === 'waiting')) return
    waits.leave(failure)
    counts.drop(failure)
    failures.delete(key)
  }
  // A wait over: its key may be asked again, its tries remembered till it passes.
  const waits = createWaits((failure) => {
    counts.move(failure, 'over')
    policy.ended?.(failure.key)
  })
  return {
    /** `key`'s read failed by `cause`: the error its read fails with, and whether it waits —
     *  asked again once its wait ends — rather than failing for good (`nextWait`). */
    record(key: string, cause: unknown) {
      let failure = failures.get(key)
      if (!failure) {
        failures.set(key, (failure = fresh(key)))
        counts.add()
      }
      const tries = ++failure.tries,
        { again, wait } = nextWait(policy, cause, tries)
      failure.error = failedRead(key, tries, cause)
      failure.due = cpuNow() + wait
      counts.move(failure, again ? 'waiting' : 'refused')
      if (again) waits.wait(failure)
      else waits.leave(failure)
      if (!again) objects.giveUp(key, failure.error)
      if (tries === 1 || !again) policy.onStalled?.({ key, cause })
      return { error: failure.error, waits: again }
    },
    /** `key` was read: its failures in a row are over. */
    passed: (key: string) => leave(key, false),
    /** Why a read of `key` is held back now — refused for good, its object invalid, or waiting its
     *  turn —, if it is: no request is sent for it. */
    blocked(key: string): Blocked | undefined {
      const gone = objects.of(key)
      if (gone) return gone
      const failure = failures.get(key)
      return failure?.state === 'over' ? undefined : (failure as Blocked | undefined)
    },
    /** `key` is let go by its owner: its failure leaves, unless its wait runs. */
    leaves: (key: string) => leave(key, true),
    /** Reads that failed and do not pass now: waiting their turn, or refused for good. */
    count: counts.stalled,
    clear() {
      waits.clear()
      failures.clear()
      objects.clear()
      counts.reset()
    },
  }
}

export type ReadFailures = ReturnType<typeof createReadFailures>
