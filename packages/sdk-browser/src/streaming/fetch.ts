import { retriableError } from '../cluster/checked.ts'
import type { StreamContext } from './types.ts'
import { recordFailure } from './failures.ts'
import { ATTEMPTS, createPageAttempt } from './fetchAttempt.ts'

/** The reads of `context`'s pages (`loadOne`): up to `ATTEMPTS` attempts each, a refusal another
 *  request would meet again asked once; what still fails waits its turn (`failures.ts`). */
export function createStreamingFetcher(
  context: StreamContext,
  touch: (url: string, bytes: Uint8Array, sha256: string) => void,
) {
  const { catalog, abort, emit } = context
  const { attempt, roundTrip, keptBytes } = createPageAttempt(context, touch)
  const loadOne = async (url: string, jobSignal: AbortSignal) => {
    const page = catalog.get(url)
    if (!page) throw new Error('Unknown page ' + url)
    const signal = AbortSignal.any([abort.signal, jobSignal])
    let cause: unknown,
      tried = 0
    for (let n = 1; n <= ATTEMPTS; n++) {
      signal.throwIfAborted()
      try {
        const array = await attempt(page, url, signal, n)
        context.failures.delete(url) // read: its failures in a row are over
        return array
      } catch (error) {
        emit?.('page-attempt-end', 'Page read attempt failed', () => ({
          ...{ version: 1, url, attempt: n, error: String(error) },
        }))
        signal.throwIfAborted()
        ;[cause, tried] = [error, n]
        // A refusal another request would meet again (a 4xx) is not asked twice (`checked`).
        if (!retriableError(error)) break
        if (n < ATTEMPTS)
          emit?.('page-retry', 'Retry after a read failure', () => ({
            ...{ version: 1, url, attempt: n, nextAttempt: n + 1, error: String(error) },
          }))
      }
    }
    const times = tried === 1 ? 'one attempt' : `${tried} attempts`
    const error = new Error(`PAGE_STREAM_FAILED: ${url} after ${times}: ${String(cause)}`, {
      cause,
    })
    recordFailure(context, url, error, cause)
    emit?.('page-error', 'Persistent page-load failure', () => ({
      ...{ version: 1, url, attempts: tried, error: String(cause) },
      sticky: !retriableError(cause),
    }))
    throw error
  }
  return { loadOne, roundTrip, keptBytes }
}
