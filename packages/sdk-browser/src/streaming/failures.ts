/**
 * WHEN A READ THAT FAILED IS ASKED AGAIN. One that may pass (`retriableError`: the network, a
 * timeout, a rate limit, a server error, an answer that is not what its page announced) waits
 * 0.5 s · 2^(k−1) after its k-th failure in a row, at most 8 s; one another request would meet
 * again — a 404, a 403 — is never asked again. The error the read fails with carries the end of
 * its wait (`Refusal.due`, the one clock: a cell's hold that failed reads it, `retryAt`). A
 * streamer refuses a page at once while its wait runs, no request sent — forgotten meanwhile and
 * asked again, still —, and says it once past the longest wait or refused for good
 * (`onStalled`): a source refusing every read of F pages is asked at most F times in the first
 * half second, then ever more seldom, down to F every 8 s — never once a frame.
 */
import { retriableError } from '../cluster/checked.ts'
import type { StreamContext } from './types.ts'

const FIRST_WAIT_MS = 500,
  LAST_WAIT_MS = 8000

/** The error a read fails with, and is refused with while its wait runs: when it may be asked
 *  again, `Infinity` for good. */
export type Refusal = Error & { due: number }
/** A page's last failure, its failures in a row, and whether it was said. */
export type ReadFailure = { error: Refusal; tries: number; said: boolean }

/** When what failed with `error` may be asked again: its read's wait, or never for a failure that
 *  is no read's (a file that does not decode: another read would meet it again). */
export const retryAt = (error: unknown) => (error as Partial<Refusal> | undefined)?.due ?? Infinity

/** The failure a request of `url` is refused with now: its wait is not over, or it never passes. */
export function refusalOf(context: StreamContext, url: string) {
  const failure = context.failures.get(url)
  return failure && failure.error.due > performance.now() ? failure.error : undefined
}

/** How many reads are refused now: their wait not over, or never passing. */
export function refusals(context: StreamContext) {
  const now = performance.now()
  let refused = 0
  for (const failure of context.failures.values()) if (failure.error.due > now) refused++
  return refused
}

/** `url` failed with `error`, its last attempt by `cause`: it waits, or is refused for good. */
export function recordFailure(context: StreamContext, url: string, error: Error, cause: unknown) {
  const { tries = 0, said = false } = context.failures.get(url) ?? {}
  const wait = retriableError(cause) ? Math.min(LAST_WAIT_MS, FIRST_WAIT_MS * 2 ** tries) : Infinity
  const due = performance.now() + wait,
    stalled = wait >= LAST_WAIT_MS
  const refused = Object.assign(error, { due })
  context.failures.set(url, { error: refused, tries: tries + 1, said: said || stalled })
  if (stalled && !said) context.onStalled?.({ url, cause })
}
