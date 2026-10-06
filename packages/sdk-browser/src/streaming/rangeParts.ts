/**
 * THE PARTS OF A RANGE READ FROM A FILE (`StreamPage.range`, the runs of world bundles): where each
 * lies in the bytes read, by its own offset in the file — never by the lengths of the parts before
 * it, so parts that are not end to end are read where they are —, and their fingerprints, checked
 * side by side.
 */
import { verifyPageBytes } from '../page/decode/host.ts'

/** A part of a file: where it starts, its length, its fingerprint. */
export type RangePart = { offset: number; bytes: number; sha256: string }

/** Where `part` lies in the bytes of a range read from `from`: `[start, end)`. */
export function partSpan(from: number, part: Pick<RangePart, 'offset' | 'bytes'>) {
  const start = part.offset - from
  return [start, start + part.bytes] as const
}

/** The first of `parts` whose bytes in `buffer`, a range read from `from`, are not its own, and the
 *  fingerprint found there — every part checked at once, each on a copy —; `undefined` when all
 *  are. */
export async function mismatchedPart(
  buffer: ArrayBuffer,
  from: number,
  parts: readonly RangePart[],
) {
  const found = await Promise.all(
    parts.map((part) => verifyPageBytes(buffer.slice(...partSpan(from, part)))),
  )
  const part = found.findIndex(({ sha256 }, at) => sha256 !== parts[at].sha256)
  return part < 0 ? undefined : { part, found: found[part].sha256 }
}
