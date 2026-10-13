import { unmetered, type ByteMeter } from './byteMeter.ts'
import { checked, letGo } from './checked.ts'
import { waitShared, waited, type SharedRead } from '../../../sdk-core/src/runtime/sharedRead.ts'

/** How one range is read: the meter counting what arrives, the requests `checked` makes at most,
 *  and the signal that lets its asker go. */
export type RangeAsk = {
  /** Counts the bytes that arrive. */
  meter?: ByteMeter
  /** The most requests `checked` makes for the range. */
  attempts?: number
  /** Lets its asker go: the read stops once none waits on it. */
  signal?: AbortSignal
}

/** A read of `length` bytes from `offset` of the file at `url` (`createRangedReads`). */
export type ReadRange = (
  url: string,
  offset: number,
  length: number,
  asked?: RangeAsk,
) => Promise<ArrayBuffer>

/** Where the ranged reads keep each file a server answered whole: the page cache, among its pages
 *  (`../streaming/pageCache.ts`). `file` is its bytes, marked used, while the cache keeps them;
 *  `keepFile` takes a file in when it fits the cache's room, evicted by last use as the pages
 *  are. */
type WholeFiles = {
  file(url: string): ArrayBuffer | undefined
  keepFile(url: string, buffer: ArrayBuffer): void
}

/** The whole file a server answered in place of a range, on its way: its download, shared by
 *  every range waiting on it. */
type Download = SharedRead<ArrayBuffer> & { stop: AbortController }

/** A file read now: the request whose answer says whether its server answers ranges, till it
 *  does; the whole file it answered instead, on its way; the reads under way. */
type Reading = {
  asking: Promise<unknown> | undefined
  download: Download | undefined
  reads: number
}

/** Bytes `[offset, offset + length)` of `whole`, copied: a view would keep the whole file alive
 *  past its eviction, uncounted. */
const cut = (whole: ArrayBuffer, offset: number, length: number) =>
  whole.slice(offset, Math.min(offset + length, whole.byteLength))

/**
 * Reads byte ranges of files, each by an HTTP Range (`checked`) as it is asked. A server that
 * ignores the Range answers the whole file: its download is shared by every range waiting on it
 * and stopped once none does before it lands. Landed, it is cut for every range waiting on it and
 * is one entry of the page cache among the pages (`files`) when it fits the cache's room, evicted
 * by last use as they are, every range cut from it until then; a file past the room is let go at
 * once. Either way it is asked again by the next range once it left. Until an origin answered a
 * range, one request of a file is sent at a time and the ranges of that file asked meanwhile wait
 * on its answer: the whole file is downloaded once. A file is followed only while a read of it is under way: what it keeps once
 * read is the cache's, and the origins that answer ranges are a few words.
 */
export function createRangedReads(files: WholeFiles) {
  /** The origins known to answer ranges: their ranges go at once, none waits on another's
   *  answer. */
  const ranged = new Set<string>()
  /** The files read now, by url: each leaves as its last read ends. */
  const reading = new Map<string, Reading>()
  /** The whole file `response` brings on `stop`: forgotten once stopped or failed. */
  const download = (file: Reading, response: Response, stop: AbortController) => {
    const own: Download = { promise: response.arrayBuffer(), askers: 0, stop }
    const forget = () => void (file.download === own && (file.download = undefined))
    stop.signal.addEventListener('abort', forget, { once: true })
    own.promise.catch(forget)
    file.download = own
  }
  /** One request of `[offset, offset + length)` of `file` at `url`, on a signal of its own that its
   *  asker's stops until the answer turns out whole: its range, or nothing once the whole file is
   *  on its way. */
  const request = async (
    file: Reading,
    url: string,
    origin: string,
    offset: number,
    length: number,
    { meter = unmetered, attempts, signal }: RangeAsk,
  ) => {
    const stop = new AbortController()
    signal?.throwIfAborted()
    const leave = () => stop.abort(signal!.reason)
    signal?.addEventListener('abort', leave, { once: true })
    const answer = checked(url, stop.signal, attempts, {
      Range: `bytes=${offset}-${offset + length - 1}`,
    })
    if (!ranged.has(origin)) file.asking = answer
    try {
      const response = meter.read(await answer, url)
      // Its asker left while it was asked: what came is let go, never kept.
      if (stop.signal.aborted) throw (letGo(response), stop.signal.reason)
      if (response.status === 206) return (ranged.add(origin), await response.arrayBuffer())
      if (!file.download) download(file, response, stop)
      else letGo(response) // a server that stopped answering ranges
    } finally {
      if (file.asking === answer) file.asking = undefined
      signal?.removeEventListener('abort', leave)
    }
  }
  const readOf = async (
    file: Reading,
    url: string,
    offset: number,
    length: number,
    asked: RangeAsk,
  ) => {
    const origin = new URL(url).origin
    // Waiting on another range's answer, its own signal still lets it go at once.
    while (!ranged.has(origin) && file.asking)
      await waited(
        file.asking.catch(() => {}),
        asked.signal,
      )
    for (;;) {
      const whole = files.file(url)
      if (whole) return cut(whole, offset, length)
      const own = file.download
      if (own) {
        // The last to leave stops the download: no one waits for it any more.
        const buffer = await waitShared(own, asked.signal, () =>
          own.stop.abort(asked.signal?.reason),
        )
        if (file.download === own) {
          file.download = undefined
          files.keepFile(url, buffer)
        }
        return cut(buffer, offset, length)
      }
      const range = await request(file, url, origin, offset, length, asked)
      if (range) return range
    }
  }
  /** Bytes `[offset, offset + length)` of the file at `url`, a copy its asker keeps. */
  const read: ReadRange = async (url, offset, length, asked = {}) => {
    let file = reading.get(url)
    if (!file) reading.set(url, (file = { asking: undefined, download: undefined, reads: 0 }))
    file.reads++
    try {
      return await readOf(file, url, offset, length, asked)
    } finally {
      if (--file.reads === 0) reading.delete(url)
    }
  }
  return read
}
