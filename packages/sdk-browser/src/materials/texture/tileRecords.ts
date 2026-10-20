import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { blocksAcross } from '../../../../sdk-core/src/texture/previewLevels.ts'
import {
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_SIDE,
} from '../../../../sdk-core/src/texture/previewFormat.ts'
import { TILE_SIZE } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { tileSpanEnd, tileSpanStart } from './tiles.ts'

/**
 * Where a tile's blocks lie in a block level file (the compiler's `tile_records`): its TILE
 * RECORDS, tile rows then tiles, each the tile's region as its pool cell receives it
 * (`tileRegion`, `../virtual/write.ts`) in whole blocks, block rows top to bottom, compressed
 * alone by raw DEFLATE. The file opens on a head of one little-endian `u32` per record — where
 * its compressed bytes end, counted from the end of the head —, whose length follows from the
 * level's dimensions: one HTTP Range reads the head, one more a tile.
 */

/** Bytes of one record's end in the head. */
export const RECORD_END_BYTES = 4

/** Blocks along one side of tile `t`'s record, for a level `texels` long on that side. */
const span = (texels: number, t: number) =>
  blocksAcross(tileSpanEnd(texels, t)) - tileSpanStart(t) / PREVIEW_BLOCK_SIDE

/** The record of tile (`tx`, `ty`) in a `width` × `height` block level file: its rank, the count
 *  of records — the head's entries —, its blocks across and down and its bytes once inflated. No
 *  array is built: a waiting tile asks every frame. */
export function tileRecord(width: number, height: number, tx: number, ty: number) {
  const tilesAcross = ceilDiv(width, TILE_SIZE)
  const across = span(width, tx),
    down = span(height, ty)
  return {
    index: ty * tilesAcross + tx,
    count: tilesAcross * ceilDiv(height, TILE_SIZE),
    across,
    down,
    bytes: across * down * PREVIEW_BLOCK_BYTES,
  }
}

/** Where record `index`'s compressed bytes lie in its file, from the file's head (`head`, the
 *  `count` record ends as the file opens on them). */
export function recordRange(head: Uint8Array, count: number, index: number) {
  const ends = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const end = (i: number) => ends.getUint32(i * RECORD_END_BYTES, true)
  const start = index === 0 ? 0 : end(index - 1)
  return { offset: count * RECORD_END_BYTES + start, bytes: end(index) - start }
}
