import {
  CLUSTER_HEADER_WORDS,
  DISK_HEADER_WORDS,
  FLAG_UV_EXTENDED,
  MAX_MORPH_TARGETS,
  MORPH_WORDS,
  REF_PLACE_BITS,
  UV_EXTENSION_WORDS,
} from '../../../../../sdk-core/src/page/format.ts'

/** The streaming pages of a page's list of dependencies it names vertices of, by their rank in the
 *  list from 1, when the page on disk `bytes` names vertices at all; `undefined` when it names none.
 *  The page's pairs (`disk.rs`, `DiskLayout::words`: the count of the vertices it names, then the
 *  count of its pairs and the byte they start at) rank a streaming page above `REF_PLACE_BITS`
 *  bits, 0 for its own. */
export function namedRanks(bytes: Uint8Array) {
  if (bytes.byteLength < CLUSTER_HEADER_WORDS * 4) return undefined
  const words = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const morphs = (words.getUint32(21 * 4, true) >> 6) & MAX_MORPH_TARGETS
  let extended = 0
  for (let bits = words.getUint32(4 * 4, true) & FLAG_UV_EXTENDED; bits; bits &= bits - 1)
    extended++
  const at = (CLUSTER_HEADER_WORDS + MORPH_WORDS * morphs + UV_EXTENSION_WORDS * extended) * 4
  if (bytes.byteLength < at + DISK_HEADER_WORDS * 4 || words.getUint32(at, true) === 0)
    return undefined
  const ranks: number[] = []
  const pairs = words.getUint32(at + 4, true),
    first = words.getUint32(at + 5 * 4, true)
  for (let i = 0; i < pairs && first + (i + 1) * 4 <= bytes.byteLength; i++) {
    const rank = words.getUint32(first + i * 4, true) >>> REF_PLACE_BITS
    if (rank && ranks[ranks.length - 1] !== rank) ranks.push(rank)
  }
  return ranks
}
