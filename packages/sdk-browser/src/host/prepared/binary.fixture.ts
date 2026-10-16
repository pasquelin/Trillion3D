// A prepared document's binary as the tests hold it — bytes in hand, or a file on disk — read the
// way the engine reads it: a view at a time, by its range (`accessors.ts`, `PreparedBinary`).
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { PreparedBinary } from './accessors.ts'
import type { ReadRange } from '../../cluster/ranged.ts'

/** The ranges of `bytes`, or of what `whole` reads, each a copy. */
export const rangesOf = (whole: ArrayBuffer | (() => Promise<ArrayBuffer>)): PreparedBinary => ({
  range: async (offset, length) =>
    (typeof whole === 'function' ? await whole() : whole).slice(offset, offset + length),
})

/** The ranges of a local file by its `file:` address, as `PageCache.readRange` answers them. */
export const fileRanges: ReadRange = async (url, offset, length) => {
  const bytes = await readFile(fileURLToPath(url))
  return bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length)
}
