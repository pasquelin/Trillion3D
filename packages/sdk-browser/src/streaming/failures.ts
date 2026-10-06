/**
 * WHEN A STREAMER ASKS AGAIN A READ THAT FAILED. One that may pass (`retriableError`: the network,
 * a timeout, a rate limit, a server error, an answer that is not what its page announced) waits
 * 0.5 s · 2^(k−1) after its k-th failure in a row, at most 8 s: a request meanwhile is refused at
 * once, no request sent, and the end of its wait is told (`onTurn`), so the view asks it again.
 * A source refusing every read of F pages is thus asked at most F times in the first half second,
 * then ever more seldom, down to F every 8 s — never once a frame. Past the longest wait the
 * failure is said once (`onStalled`). One another request would meet again — a 404, a 403 — is
 * refused for good.
 */
import { pause, retriableError } from '../cluster/checked.ts'
import type { StreamContext } from './types.ts'

const FIRST_WAIT_MS = 500,
  LAST_WAIT_MS = 8000

/** A page's last failure, its failures in a row, when it may be asked again, whether it was said. */
export type ReadFailure = { error: Error; tries: number; due: number; said: boolean }

/** The failure a request of `url` is refused with now: its wait is not over, or it never passes. */
export function refusalOf(context: StreamContext, url: string) {
  const failure = context.failures.get(url)
  return failure && failure.due > performance.now() ? failure.error : undefined
}

/** How many reads are refused now: their wait not over, or never passing. */
export function refusals(context: StreamContext) {
  const now = performance.now()
  let refused = 0
  for (const failure of context.failures.values()) if (failure.due > now) refused++
  return refused
}

/** `url` failed with `error`, its last attempt by `cause`: it waits its turn, or is refused for
 *  good. */
export function recordFailure(context: StreamContext, url: string, error: Error, cause: unknown) {
  const { failures, abort, state } = context
  const failure = failures.get(url) ?? { error, tries: 0, due: 0, said: false }
  failures.set(url, failure)
  failure.error = error
  if (!retriableError(cause)) {
    failure.due = Infinity
    return
  }
  const wait = Math.min(LAST_WAIT_MS, FIRST_WAIT_MS * 2 ** failure.tries++)
  const due = (failure.due = performance.now() + wait)
  const turn = () => {
    // Its wait is over once its turn is told, whatever the clocks' rounding: the view asks it then.
    if (failure.due === due) failure.due = Math.min(due, performance.now())
    state.turns++
    context.onTurn?.()
  }
  // A streamer closed meanwhile asks nothing again.
  void pause(wait, abort.signal).then(turn, () => {})
  if (wait < LAST_WAIT_MS || failure.said) return
  failure.said = true
  context.onStalled?.({ url, cause })
}
