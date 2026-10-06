/**
 * WHEN A READ THAT FAILED IS ASKED AGAIN. One that may pass (`retriableError`: the network, a
 * timeout, a rate limit, a server error, an answer that is not what its page announced) waits
 * 0.5 s · 2^(k−1) after its k-th failure in a row, at most 8 s (`backoff`); one another request
 * would meet again — a 404, a 403 — is never asked again. A streamer refuses a page at once while
 * its wait runs, no request sent, and says it once past the longest wait (`onStalled`): a source
 * refusing every read of F pages is asked at most F times in the first half second, then ever
 * more seldom, down to F every 8 s — never once a frame. A cell's hold that failed waits the same
 * (`../partition/cellPages.ts`).
 */
import { retriableError } from '../cluster/checked.ts'
import type { StreamContext } from './types.ts'

const FIRST_WAIT_MS = 500,
  LAST_WAIT_MS = 8000

/** How long a read that failed `tries` times in a row waits before it is asked again, `error` its
 *  last failure or what caused it: for good (`Infinity`) when another request would meet it again. */
export function backoff(tries: number, error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined
  if (!retriableError(error) || !retriableError(cause)) return Infinity
  return Math.min(LAST_WAIT_MS, FIRST_WAIT_MS * 2 ** (tries - 1))
}

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

/** `url` failed with `error`, its last attempt by `cause`: it waits, or is refused for good. */
export function recordFailure(context: StreamContext, url: string, error: Error, cause: unknown) {
  const failure = context.failures.get(url) ?? { error, tries: 0, due: 0, said: false }
  context.failures.set(url, failure)
  failure.error = error
  const wait = backoff(++failure.tries, cause)
  failure.due = performance.now() + wait
  if (wait !== LAST_WAIT_MS || failure.said) return
  failure.said = true
  context.onStalled?.({ url, cause })
}
