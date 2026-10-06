/**
 * THE CHECK OF A PAGE'S BYTES AGAINST WHAT IT ANNOUNCED, one for every read — through the queue or
 * at open —: its size, then its fingerprint, or, a range read from a file (`StreamPage.range`, the
 * runs of world bundles), each part's, where it lies in the bytes read, by its own offset in the
 * file — never by the lengths of the parts before it, so parts that are not end to end are read
 * where they are —, the parts checked side by side.
 */
import type { EngineError } from '../../../sdk-core/src/index.ts'
import { corruptObject } from '../cluster/pages.ts'
import { verifyPageBytes } from '../page/decode/host.ts'

/** A part of a file: where it starts, its length, its fingerprint. */
export type RangePart = { offset: number; bytes: number; sha256: string }
/** What a page announced: its size and fingerprint, and, a range of a file, its parts. */
type Announced = {
  bytes: number
  sha256: string
  range?: { offset: number; parts: readonly RangePart[] }
}
/** A page's bytes checked: the bytes to keep, or the refusal and the fingerprint found. */
type Checked = { buffer?: ArrayBuffer; refused?: EngineError; found?: string }

/** Where `part` lies in the bytes of a range read from `from`: `[start, end)`. */
export function partSpan(from: number, part: Pick<RangePart, 'offset' | 'bytes'>) {
  const start = part.offset - from
  return [start, start + part.bytes] as const
}

/** The first of `parts` whose bytes in `buffer`, a range read from `from`, are not its own, and the
 *  fingerprint found there — every part checked at once, each on a copy —; `undefined` when all
 *  are. */
async function mismatchedPart(buffer: ArrayBuffer, from: number, parts: readonly RangePart[]) {
  const found = await Promise.all(
    parts.map((part) => verifyPageBytes(buffer.slice(...partSpan(from, part)))),
  )
  const part = found.findIndex(({ sha256 }, at) => sha256 !== parts[at].sha256)
  return part < 0 ? undefined : { part, found: found[part].sha256 }
}

/** `buffer`, `page`'s bytes read at `url`, checked against what it announced: the bytes to keep, or
 *  refused by `corruptObject` — its size, else its fingerprint, else the first part whose
 *  fingerprint differs — with the fingerprint found (none when the size differs already). A whole
 *  page's fingerprint transfers its buffer to a decode worker and back: the one returned is the one
 *  to read. */
export async function verified(
  page: Announced,
  url: string,
  buffer: ArrayBuffer,
): Promise<Checked> {
  const bytes = buffer.byteLength
  if (bytes !== page.bytes) return { refused: corruptObject(url, page, bytes, undefined) }
  if (!page.range) {
    const { sha256: found, source } = await verifyPageBytes(buffer)
    if (found === page.sha256) return { buffer: source }
    return { refused: corruptObject(url, page, bytes, found), found }
  }
  const wrong = await mismatchedPart(buffer, page.range.offset, page.range.parts)
  if (!wrong) return { buffer }
  const part = page.range.parts[wrong.part]
  return { refused: corruptObject(url, part, part.bytes, wrong.found), found: wrong.found }
}
