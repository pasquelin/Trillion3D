import { unmetered, type ByteMeter } from './byteMeter.ts'
import { checked } from './checked.ts'

/** How one range is read: the meter counting what arrives, the requests `checked` makes at most,
 *  and the signal that lets its asker go, the reader's own by default. */
type Asked = { meter?: ByteMeter; attempts?: number; signal?: AbortSignal }
/** The whole file a server answered for a range: its bytes on their way or landed, the reads
 *  waiting on them before they landed, and what stops it. */
type Whole = { bytes: Promise<ArrayBuffer>; landed: boolean; askers: number; stop: AbortController }

/** `whole`'s bytes waited on by one read until `signal` lets it go: once the last read waiting on
 *  them let go before they landed, their download stops, and `stopped` is told. */
function waited(whole: Whole, signal: AbortSignal | undefined, stopped: () => void) {
  whole.askers++
  if (!signal) return whole.bytes
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const leave = () => {
      if (--whole.askers === 0 && !whole.landed) {
        whole.stop.abort(signal.reason)
        stopped()
      }
      reject(signal.reason)
    }
    if (signal.aborted) return leave()
    signal.addEventListener('abort', leave, { once: true })
    void whole.bytes.then(resolve, reject).finally(() => signal.removeEventListener('abort', leave))
  })
}

/**
 * Reads byte ranges of the file at `url`, each by an HTTP Range (`checked`) as it is `asked`. A
 * server that ignores the Range answers the whole file: its download is the reader's, not the
 * read's that asked it — every range waits on it, and it stops only once none does —, then it is
 * kept and read no more, its length told by `held`. Until the first answer says which, the ranges
 * asked at once wait on it rather than each fetching.
 */
export function rangedReader(url: string, signal?: AbortSignal) {
  let whole: Whole | undefined,
    first: Promise<unknown> | undefined,
    held = 0
  /** One request of `[offset, offset + length)`, on a signal of its own that its asker's stops
   *  until the answer turns out whole: its range, or nothing once the whole file is kept. */
  const request = async (offset: number, length: number, asked: Asked) => {
    const own = asked.signal ?? signal,
      stop = new AbortController()
    own?.throwIfAborted()
    const leave = () => stop.abort(own!.reason)
    own?.addEventListener('abort', leave, { once: true })
    try {
      const lifetime = signal ? AbortSignal.any([stop.signal, signal]) : stop.signal
      const answer = checked(url, lifetime, asked.attempts, {
        Range: `bytes=${offset}-${offset + length - 1}`,
      })
      first ??= answer
      const response = (asked.meter ?? unmetered).read(await answer, url)
      if (response.status === 206) return await response.arrayBuffer()
      keep({ bytes: response.arrayBuffer(), landed: false, askers: 0, stop })
    } finally {
      own?.removeEventListener('abort', leave)
    }
  }
  /** The whole file `answer` brings is kept, unless another already is; a failed one is not. */
  const keep = (answer: Whole) => {
    if (whole) return answer.stop.abort()
    whole = answer
    answer.bytes.then(
      (buffer) => {
        answer.landed = true
        if (whole === answer) held = buffer.byteLength
      },
      () => void (whole === answer && (whole = undefined)),
    )
  }
  const read = async (offset: number, length: number, asked: Asked = {}) => {
    if (first) await first.catch(() => {})
    if (!whole) {
      const range = await request(offset, length, asked)
      if (range) return range
    }
    const own = whole!
    const bytes = await waited(own, asked.signal ?? signal, () => {
      if (whole === own) whole = undefined
    })
    return bytes.slice(offset, offset + length)
  }
  /** The bytes the whole file holds once a server answered it whole, else zero. */
  return Object.assign(read, { held: () => held })
}
