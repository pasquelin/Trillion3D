/**
 * WHEN A READ THAT FAILED IS ASKED AGAIN. One that may pass (`retriableError`: the network, a
 * timeout, a rate limit, a server error, an answer that is not what its page announced) waits
 * 0.5 s · 2^(k−1) after its k-th failure in a row, at most 8 s; one another request would meet
 * again — a 404, a 403 — is never asked again. The error the read fails with carries the end of
 * its wait (`Refusal.due`, the one clock: a cell's hold that failed reads it, `retryAt`), and
 * whether it is final: refused for good, or past the longest wait (`stalled`). A streamer refuses
 * a page at once while its wait runs, no request sent, counting it (`state.refused`) till it ends,
 * and says it once when final (`onStalled`): a source refusing every read of F pages is asked at
 * most F times in the first half second, then ever more seldom, down to F every 8 s — never once
 * a frame. A failure outlives its page while its wait runs — asked again meanwhile, it is still
 * refused — and leaves once it ended; one for good leaves with it, nothing asking it any more.
 */
import { pause, retriableError } from '../cluster/checked.ts'
import type { StreamContext } from './types.ts'

const FIRST_WAIT_MS = 500,
  LAST_WAIT_MS = 8000

/** The error a read fails with, and is refused with while its wait runs: when it may be asked
 *  again, `Infinity` for good, and whether it is final. */
export type Refusal = Error & { due: number; stalled: boolean }
/** A page's last failure, its failures in a row, and whether it was said. */
export type ReadFailure = { error: Refusal; tries: number; said: boolean }

/** When what failed with `error` may be asked again: its read's wait, or never for a failure that
 *  is no read's (a file that does not decode: another read would meet it again). */
export const retryAt = (error: unknown) => (error as Partial<Refusal> | undefined)?.due ?? Infinity
/** Whether what failed with `error` is final — refused for good, past the longest wait, or no
 *  read's failure —, else one more wait asks it again. */
export const finalFailure = (error: unknown) => (error as Partial<Refusal>)?.stalled !== false

/** The failure a request of `url` is refused with now: its wait is not over, or it never passes. */
export function refusalOf(context: StreamContext, url: string) {
  const failure = context.failures.get(url)
  return failure && failure.error.due > performance.now() ? failure.error : undefined
}

/** `url` left the catalogue: its failure leaves once its wait is over, at once when for good. */
export function failureLeaves(context: StreamContext, url: string) {
  const due = context.failures.get(url)?.error.due ?? 0
  if (due > performance.now() && due < Infinity) return
  if (due === Infinity) context.state.refused--
  context.failures.delete(url)
}

/** `url`'s failure `refused` waited its time: refused no more, and gone if its page is. */
function waitedOut(context: StreamContext, url: string, refused: Refusal) {
  context.state.refused--
  if (context.failures.get(url)?.error === refused && !context.catalog.has(url))
    context.failures.delete(url)
}

/** `url` failed with `error`, its last attempt by `cause`: it waits, or is refused for good. */
export function recordFailure(context: StreamContext, url: string, error: Error, cause: unknown) {
  const { tries = 0, said = false } = context.failures.get(url) ?? {}
  const wait = retriableError(cause) ? Math.min(LAST_WAIT_MS, FIRST_WAIT_MS * 2 ** tries) : Infinity
  const stalled = wait >= LAST_WAIT_MS
  const refused = Object.assign(error, { due: performance.now() + wait, stalled })
  context.failures.set(url, { error: refused, tries: tries + 1, said: said || stalled })
  context.state.refused++
  // A streamer closed meanwhile counts nothing more.
  if (wait < Infinity)
    void pause(wait, context.abort.signal).then(
      () => waitedOut(context, url, refused),
      () => {},
    )
  if (stalled && !said) context.onStalled?.({ url, cause })
}
