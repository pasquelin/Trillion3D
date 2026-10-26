import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_SIDE,
  PREVIEW_HALF_FILE,
  PREVIEW_HALF_TEXEL_BYTES,
  PREVIEW_LAYOUT_FILES,
  PREVIEW_STORED_FORMAT,
  previewLayoutBlockBytes,
  type StoredLayout,
} from '../../../../sdk-core/src/texture/previewFormat.ts'
import { TILE_SIZE } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { tileSpanEnd, tileSpanStart } from './tiles.ts'

/**
 * Where a tile's blocks lie in a block level file (the compiler's `tile_records`): its TILE
 * RECORDS, tile rows then tiles, each the tile's region as its pool cell receives it
 * (`tileRegion`, `../virtual/write.ts`) in whole blocks, block rows top to bottom, compressed
 * alone by raw DEFLATE. The file opens on a head of one little-endian `u32` per record — where
 * its compressed bytes end, counted from the end of the head —, whose length follows from the
 * level's dimensions: one HTTP Range reads the head, one more a tile. A half-float level file is
 * cut the same way in texels, eight bytes each, instead of blocks.
 */

/** What a record is cut in: units `side` texels wide, `bytes` each — blocks, or half-float texels. */
type Cell = { side: number; bytes: number }
const HALF_TEXELS: Cell = { side: 1, bytes: PREVIEW_HALF_TEXEL_BYTES }

/** Bytes of one record's end in the head. */
export const RECORD_END_BYTES = 4

/** Cells along one side of tile `t`'s record, for a level `texels` long on that side. */
const span = (texels: number, t: number, side: number) =>
  ceilDiv(tileSpanEnd(texels, t), side) - tileSpanStart(t) / side

/** The layout each stored-family level file holds, by its format name. */
const LAYOUT_OF_FILE = new Map(
  Object.entries(PREVIEW_LAYOUT_FILES[PREVIEW_STORED_FORMAT]).map(([layout, file]) => [
    file as string,
    layout as StoredLayout,
  ]),
)

/** The cell a level file of `format` is cut in: half-float texels, or the blocks of its layout —
 *  sixteen bytes unless the layout says otherwise (BC4's eight, the float files' squares). */
export const cellOf = (format: string): Cell => {
  const layout = LAYOUT_OF_FILE.get(format)
  return format === PREVIEW_HALF_FILE
    ? HALF_TEXELS
    : {
        side: PREVIEW_BLOCK_SIDE,
        bytes: layout ? previewLayoutBlockBytes(layout) : PREVIEW_BLOCK_BYTES,
      }
}

/** The record of tile (`tx`, `ty`) in a `width` × `height` level file of `format` — of blocks, or of
 *  half-float texels —: its rank, the count of records — the head's entries —, its cells across
 *  and down and its bytes once inflated. No array is built: a waiting tile asks every frame. */
export function tileRecord(width: number, height: number, tx: number, ty: number, format = 'bc7') {
  const cell = cellOf(format)
  const tilesAcross = ceilDiv(width, TILE_SIZE)
  const across = span(width, tx, cell.side),
    down = span(height, ty, cell.side)
  return {
    index: ty * tilesAcross + tx,
    count: tilesAcross * ceilDiv(height, TILE_SIZE),
    across,
    down,
    bytes: across * down * cell.bytes,
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
