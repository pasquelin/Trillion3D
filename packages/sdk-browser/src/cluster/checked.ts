/**
 * The engine's one HTTP loader (`checked`) and its policy: one retry on what may pass, a capped
 * `Retry-After`, abort through the caller's signal, and one refusal code, `RESOURCE_HTTP_ERROR`,
 * naming the address. It imports nothing else, so a worker loads it alone.
 */
import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import { RETRY_AFTER_CAP_MS } from './retryCap.ts'
/** Whether a failure of HTTP `status` a second request may not meet: the network (`null`), a
 *  timeout (408), a rate limit (429) or a server error (5xx). Any other 4xx would meet it again. */
const retriable = (status: number | null) =>
  status === null || status >= 500 || status === 408 || status === 429
/** The ms `response`'s `Retry-After` asks to wait (seconds or an HTTP date), capped, 0 for none. */
const retryAfter = (response: Response) => {
  const value = response.headers.get('retry-after') ?? ''
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()
  return ms > 0 ? Math.min(ms, RETRY_AFTER_CAP_MS) : 0
}
/** Waits `ms`, or rejects with the reason of `signal` once it aborts. */
export const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const stop = () => (clearTimeout(timer), reject(signal?.reason))
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => resolve(signal?.removeEventListener('abort', stop)), ms)
    signal?.addEventListener('abort', stop, { once: true })
  })
/** The HTTP status `error` was refused with (`checked`), `null` for none: the network, or an
 *  error of another kind — one whose details carry the status of an answer taken (a JSON that
 *  does not parse) is no refusal. */
export const refusedStatus = (error: unknown) => {
  const refused = error instanceof EngineError && error.code === 'RESOURCE_HTTP_ERROR'
  const status = refused ? error.details.status : null
  return typeof status === 'number' ? status : null
}
/** Whether the read that failed with `error` is worth asking again (`retriable`): a 4xx is not. */
export const retriableError = (error: unknown) => retriable(refusedStatus(error))
/** A refused answer's body let go at once, not left to hold its connection until collected. */
export const letGo = (response: Response) => void response.body?.cancel().catch(() => {})
/** What an optional file's absence answers: a 404, or the 403 of a store that hides what it lacks. */
const ABSENT = new Set([403, 404])

/** The attempts of a caller that retries on its own terms — the page streamer, the GPU page
 *  cache, the physics tiles, the world bundles a cell holds: one request. */
export const ONE_REQUEST = 1
/** The requests `checked` makes by default: the first, and one more when it may pass. The
 *  families' on-demand loader tries each import as many times (`../host/onDemand.ts`). */
export const HTTP_ATTEMPTS = 2

/**
 * Reads `url`, asking once more (`attempts`, the most requests it makes) when the first request
 * fails in a way that may pass (`retriable`), after the wait its `Retry-After` asks, capped
 * (`RETRY_AFTER_CAP_MS`); a refusal another request would meet again — a 404, a 403 — is not
 * asked twice. What still fails is refused by an `EngineError` naming the address. An aborted
 * `signal` rejects with its reason and asks nothing more; `headers` go with every request (a
 * texture tile's `Range`). The SDK guide states this policy (docs/SDK.md).
 */
export async function checked(
  url: string,
  signal?: AbortSignal,
  attempts = HTTP_ATTEMPTS,
  headers?: HeadersInit,
) {
  let response: Response | undefined, cause: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted()
    try {
      response = await fetch(url, { signal, headers })
    } catch (error) {
      signal?.throwIfAborted()
      ;[response, cause] = [undefined, error]
    }
    if (response && !retriable(response.status)) break
    if (attempt === attempts || !response) continue
    letGo(response)
    const wait = retryAfter(response)
    if (wait) await pause(wait, signal)
  }
  // A network failure is the same refusal as an HTTP one, with no status to give.
  if (!response)
    throw new EngineError(
      'RESOURCE_HTTP_ERROR',
      `${url}: ${String(cause)} (${attempts === 1 ? 'one request' : `${attempts} requests`})`,
      {
        url,
        status: null,
        contentType: null,
      },
    )
  if (response.ok) return response
  letGo(response)
  const contentType = response.headers.get('content-type'),
    wait = retryAfter(response)
  // The wait the server asked, capped, for a caller that retries on its own terms (`ONE_REQUEST`).
  throw new EngineError(
    'RESOURCE_HTTP_ERROR',
    `${url}: HTTP ${response.status}, type ${contentType ?? 'absent'}`,
    { url, status: response.status, contentType, ...(wait > 0 && { retryAfter: wait }) },
  )
}
/** The ms the server asked to wait before `error`'s request is sent again (`Retry-After`, capped),
 *  0 when it asked none. */
export const retryAfterOf = (error: unknown) => {
  const wait = error instanceof EngineError ? error.details.retryAfter : undefined
  return typeof wait === 'number' ? wait : 0
}
/** `checked` for a file that may be absent: its 404, or the 403 of a store that hides what it
 *  lacks (`ABSENT`), answers `null`; any other refusal still rejects. */
export const optionalFile = (url: string, signal?: AbortSignal) =>
  checked(url, signal).catch((error: unknown) => {
    if (ABSENT.has(refusedStatus(error) ?? 0)) return null
    throw error
  })
