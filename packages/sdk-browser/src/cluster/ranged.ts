import { unmetered, type ByteMeter } from './byteMeter.ts'
import { checked, letGo } from './checked.ts'
import { waitShared, waited, type SharedRead } from '../../../sdk-core/src/runtime/sharedRead.ts'

/** How one range is read: the meter counting what arrives, the requests `checked` makes at most,
 *  and the signal that lets its asker go, the reader's own by default. */
type Asked = { meter?: ByteMeter; attempts?: number; signal?: AbortSignal }

/** Where a reader keeps the whole file a server answered in place of a range (`PageCache.reader`):
 *  `touch`, `bytes` long, as each read cuts from it; `hold` while reads wait on it and `release`
 *  once none does; `drop` once the reader lets it go. The keeper takes it back by the reader's
 *  `evict`. */
export type WholeKeeper = {
  touch(bytes: number): void
  hold(): void
  release(): void
  drop(): void
}

/** No keeper: the reader keeps its whole file till it lets it go itself, or is let go. */
const unkept: WholeKeeper = { touch() {}, hold() {}, release() {}, drop() {} }

/** The union of the spans `[start, end)`: each added, it returns the bytes they cover. One binary
 *  search and one splice a span. */
function createSpanUnion() {
  /** `start, end` pairs, disjoint, apart and in order. */
  const spans: number[] = []
  let covered = 0
  return (start: number, end: number) => {
    // The first span that ends at or past `start`: it and those after it that start at or before
    // `end` merge into the one added.
    let low = 0,
      high = spans.length >> 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (spans[2 * mid + 1] < start) low = mid + 1
      else high = mid
    }
    let last = low,
      from = start,
      to = end
    for (; last < spans.length >> 1 && spans[2 * last] <= end; last++) {
      from = Math.min(from, spans[2 * last])
      to = Math.max(to, spans[2 * last + 1])
      covered -= spans[2 * last + 1] - spans[2 * last]
    }
    spans.splice(2 * low, 2 * (last - low), from, to)
    return (covered += to - from)
  }
}

/** The whole file a server answered: its download, the reader's, and the bytes cut from it. */
type Whole = SharedRead<ArrayBuffer> & {
  stop: AbortController
  cut: ReturnType<typeof createSpanUnion>
}

/**
 * Reads byte ranges of the file at `url`, each by an HTTP Range (`checked`) as it is `asked`. A
 * server that ignores the Range answers the whole file: its download is the reader's, shared by
 * every range waiting on it and stopped once none does before it lands. Landed, it is one entry of
 * its `keeper`'s cache among the pages, and as they are: touched by each read, held while one
 * waits on it, evicted by last use (`evict`) and asked again by the next range. Each range is a
 * copy its asker keeps, the file let go once every byte of it is copied out: a view would keep the
 * whole file alive past its eviction, uncounted. Until the server answered a range, one request is
 * sent at a time and the ranges asked meanwhile wait on its answer: the whole file is downloaded
 * once.
 */
export function rangedReader(url: string, signal?: AbortSignal, keeper = unkept) {
  /** Whether the server answered a range; the request whose answer will say, till it does; the
   *  whole file it answered instead, on its way or landed; its length once landed; the reads that
   *  wait on it. */
  let ranged = false,
    asking: Promise<unknown> | undefined,
    whole: Whole | undefined,
    held = 0,
    reading = 0
  /** Lets `own` go if it is still the whole file kept, its keeper told. */
  const forget = (own: Whole) => {
    if (whole !== own) return
    whole = undefined
    held = 0
    keeper.drop()
  }
  /** The whole file `response` brings on `stop`, the reader's: forgotten once stopped or failed. */
  const keep = (response: Response, stop: AbortController) => {
    const own = { promise: response.arrayBuffer(), askers: 0, stop, cut: createSpanUnion() }
    stop.signal.addEventListener('abort', () => forget(own), { once: true })
    // Stopped before it landed, it is forgotten, and holds nothing.
    own.promise.then(
      (buffer) => void (whole === own && (held = buffer.byteLength)),
      () => forget(own),
    )
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
      // Its asker left while it was asked: what came is let go, never kept.
      if (stop.signal.aborted) throw (letGo(response), stop.signal.reason)
      if (response.status === 206) return ((ranged = true), await response.arrayBuffer())
      if (!whole) keep(response, stop)
      else letGo(response) // a server that stopped answering ranges
    } finally {
      if (asking === answer) asking = undefined
      own?.removeEventListener('abort', leave)
    }
  }
  const read = async (offset: number, length: number, asked: Asked = {}) => {
    // Waiting on another range's answer, its own signal still lets it go at once.
    while (!ranged && asking)
      await waited(
        asking.catch(() => {}),
        asked.signal ?? signal,
      )
    // The whole file kept, or asked: again if it left before this read could hold it.
    let found = whole
    while (!found) {
      const range = await request(offset, length, asked)
      if (range) return range
      found = whole
    }
    const own = found,
      mine = asked.signal ?? signal
    // Held from before it waits, and counted by its keeper only once held: no eviction takes the
    // file a read is about to cut from.
    if (reading++ === 0) keeper.hold()
    try {
      // The last to leave stops the download: no one waits for it any more.
      const bytes = await waitShared(own, mine, () => own.stop.abort(mine?.reason))
      if (whole === own) keeper.touch(bytes.byteLength)
      const end = Math.min(offset + length, bytes.byteLength)
      const range = bytes.slice(offset, end)
      if (own.cut(Math.min(offset, end), end) === bytes.byteLength) forget(own)
      return range
    } finally {
      if (--reading === 0) keeper.release()
    }
  }
  /** The bytes of the whole file it keeps once a server answered it whole, else zero; and its
   *  keeper's eviction of it: the next range asks the server again. */
  return Object.assign(read, {
    held: () => held,
    evict() {
      whole = undefined
      held = 0
    },
  })
}
