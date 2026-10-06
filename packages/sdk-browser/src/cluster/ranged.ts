import { unmetered, type ByteMeter } from './byteMeter.ts'
import { checked } from './checked.ts'
import { waitShared, type SharedRead } from '../../../sdk-core/src/runtime/sharedRead.ts'

/** How one range is read: the meter counting what arrives, the requests `checked` makes at most,
 *  and the signal that lets its asker go, the reader's own by default. */
type Asked = { meter?: ByteMeter; attempts?: number; signal?: AbortSignal }

/**
 * Reads byte ranges of the file at `url`, each by an HTTP Range (`checked`) as it is `asked`. A
 * server that ignores the Range answers the whole file: its download is the reader's, shared by
 * every range waiting on it and stopped once none does before it lands; landed, it is kept and
 * read no more, its length told by `held`. Until the server answered a range, one request is sent
 * at a time and the ranges asked meanwhile wait on its answer: the whole file is downloaded once.
 */
export function rangedReader(url: string, signal?: AbortSignal) {
  /** Whether the server answered a range; the request whose answer will say, till it does; the
   *  whole file it answered instead, on its way or landed; its length once landed. */
  let ranged = false,
    asking: Promise<unknown> | undefined,
    whole: SharedRead<ArrayBuffer> | undefined,
    held = 0
  /** The whole file `response` brings on `stop`, the reader's: forgotten once stopped or failed. */
  const keep = (response: Response, stop: AbortController) => {
    const own = { promise: response.arrayBuffer(), askers: 0, stop }
    const forget = () => void (whole === own && (whole = undefined))
    stop.signal.addEventListener('abort', forget, { once: true })
    own.promise.then((buffer) => {
      stop.signal.removeEventListener('abort', forget)
      held = buffer.byteLength
    }, forget)
    whole = own
  }
  /** One request of `[offset, offset + length)`, on a signal of its own that its asker's stops
   *  until the answer turns out whole: its range, or nothing once the whole file is kept. */
  const request = async (offset: number, length: number, asked: Asked) => {
    const own = asked.signal ?? signal,
      stop = new AbortController()
    own?.throwIfAborted()
    const leave = () => stop.abort(own!.reason)
    own?.addEventListener('abort', leave, { once: true })
    const lifetime = signal ? AbortSignal.any([stop.signal, signal]) : stop.signal
    const answer = checked(url, lifetime, asked.attempts, {
      Range: `bytes=${offset}-${offset + length - 1}`,
    })
    if (!ranged) asking = answer
    try {
      const response = (asked.meter ?? unmetered).read(await answer, url)
      if (response.status === 206) return ((ranged = true), await response.arrayBuffer())
      if (!whole) keep(response, stop)
      else void response.body?.cancel().catch(() => {}) // a server that stopped answering ranges
    } finally {
      if (asking === answer) asking = undefined
      own?.removeEventListener('abort', leave)
    }
  }
  const read = async (offset: number, length: number, asked: Asked = {}) => {
    while (!ranged && asking) await asking.catch(() => {})
    if (!whole) {
      const range = await request(offset, length, asked)
      if (range) return range
    }
    const bytes = await waitShared(whole!, asked.signal ?? signal)
    return bytes.slice(offset, offset + length)
  }
  /** The bytes the whole file holds once a server answered it whole, else zero. */
  return Object.assign(read, { held: () => held })
}
