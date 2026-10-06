import { unmetered, type ByteMeter } from './byteMeter.ts'
import { checked } from './checked.ts'

/** How one range is read: the meter counting what arrives, the requests `checked` makes at most,
 *  and the signal that cancels it, the reader's own by default. */
type Asked = { meter?: ByteMeter; attempts?: number; signal?: AbortSignal }

/**
 * Reads byte ranges of the file at `url`, each by an HTTP Range (`checked`) as it is `asked`. A
 * server that ignores the Range answers the whole file: kept, then read no more, its length told
 * by `held`. Until the first answer says which, the ranges asked at once wait on it rather than
 * each fetching.
 */
export function rangedReader(url: string, signal?: AbortSignal) {
  let whole: Promise<ArrayBuffer> | undefined,
    first: Promise<unknown> | undefined,
    held = 0
  const read = async (offset: number, length: number, asked: Asked = {}) => {
    const { meter = unmetered, attempts } = asked
    if (first) await first.catch(() => {})
    if (!whole) {
      const answer = checked(url, asked.signal ?? signal, attempts, {
        Range: `bytes=${offset}-${offset + length - 1}`,
      })
      first ??= answer
      const response = meter.read(await answer, url)
      if (response.status === 206) return response.arrayBuffer()
      const kept = response.arrayBuffer()
      whole ??= kept
      kept.then(
        (buffer) => {
          if (whole === kept) held = buffer.byteLength
        },
        // A failed read is not kept: the next need reads again.
        () => {
          if (whole === kept) whole = undefined
        },
      )
    }
    return (await whole).slice(offset, offset + length)
  }
  /** The bytes the whole file holds once a server answered it whole, else zero. */
  return Object.assign(read, { held: () => held })
}
