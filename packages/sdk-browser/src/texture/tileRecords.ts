import {
  blocksAcross,
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_SIDE,
} from '../../../sdk-core/src/index.ts'
import { TILE_BORDER, TILE_SIZE } from './tiles.ts'

/**
 * Where a tile's blocks lie in a block level file (STR-12, #962; the compiler's `tile_records`):
 * its TILE RECORDS, tile rows then tiles, each the tile's region as its pool cell receives it
 * (`tileRegion`, `../webgpu/tile/write.ts`) in whole blocks, block rows top to bottom. No index is
 * stored: every offset follows from the level's dimensions; one HTTP Range reads one tile.
 */

/** Blocks along one side of tile `t`'s record, for a level `texels` long on that side. */
const span = (texels: number, t: number) =>
  blocksAcross(Math.min(texels, (t + 1) * TILE_SIZE + TILE_BORDER)) -
  Math.max(0, t * TILE_SIZE - TILE_BORDER) / PREVIEW_BLOCK_SIDE
/** Blocks along one side of the records of tiles `0 … end - 1`; all of them by default. */
function spans(texels: number, end = Math.ceil(texels / TILE_SIZE)) {
  let blocks = 0
  for (let t = 0; t < end; t++) blocks += span(texels, t)
  return blocks
}

/** Bytes of a `width` × `height` block level file: its records end to end. */
export const tiledLevelBytes = (width: number, height: number) =>
  spans(width) * spans(height) * PREVIEW_BLOCK_BYTES

/** The record of tile (`tx`, `ty`) in a `width` × `height` block level file: its first byte and
 *  its length. No array is built: a waiting tile asks every frame. */
export function tileRecord(width: number, height: number, tx: number, ty: number) {
  const down = span(height, ty)
  const blocks = spans(height, ty) * spans(width) + down * spans(width, tx)
  return {
    offset: blocks * PREVIEW_BLOCK_BYTES,
    bytes: span(width, tx) * down * PREVIEW_BLOCK_BYTES,
  }
}
