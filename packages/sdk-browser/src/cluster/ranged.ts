import { unmetered, type ByteMeter } from './byteMeter.ts'
import { checked } from './checked.ts'

/**
 * Reads byte ranges of the file at `url`, each by an HTTP Range (`checked`, in `attempts` requests
 * at most), the `meter` a read names counting what arrives. A server that ignores the Range answers
 * the whole file: kept, then read no more, its length told by `held`. Until the first answer says
 * which, the ranges asked at once wait on it rather than each fetching.
 */
export function rangedReader(url: string, signal?: AbortSignal) {
  let whole: Promise<ArrayBuffer> | undefined,
    first: Promise<unknown> | undefined,
    held = 0
  const read = async (
    offset: number,
    length: number,
    meter: ByteMeter = unmetered,
    attempts?: number,
  ) => {
    if (first) await first.catch(() => {})
    if (!whole) {
      const asked = checked(url, signal, attempts, {
        Range: `bytes=${offset}-${offset + length - 1}`,
      })
      first ??= asked
      const response = meter.read(await asked, url)
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
