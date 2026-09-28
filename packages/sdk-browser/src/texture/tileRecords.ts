import {
  blocksAcross,
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_SIDE,
} from '../../../sdk-core/src/index.ts';
import { TILE_BORDER, TILE_SIZE } from './tiles.ts';

/**
 * Where a tile's blocks lie in a block level file (STR-12, #962; the compiler's `tile_records`):
 * its TILE RECORDS, tile rows then tiles, each the tile's region as its pool cell receives it
 * (`tileRegion`, `../webgpu/tile/write.ts`) in whole blocks, block rows top to bottom. No index is
 * stored: every offset follows from the level's dimensions; one HTTP Range reads one tile.
 */

/** Blocks along one side of each tile's record, for a level `texels` long on that side. */
function spans(texels: number) {
  const tiles = Math.ceil(texels / TILE_SIZE);
  return Array.from(
    { length: tiles },
    (_, t) =>
      blocksAcross(Math.min(texels, (t + 1) * TILE_SIZE + TILE_BORDER)) -
      Math.max(0, t * TILE_SIZE - TILE_BORDER) / PREVIEW_BLOCK_SIDE,
  );
}
const sum = (values: number[], end = values.length) =>
  values.slice(0, end).reduce((total, value) => total + value, 0);

/** Bytes of a `width` × `height` block level file: its records end to end. */
export const tiledLevelBytes = (width: number, height: number) =>
  sum(spans(width)) * sum(spans(height)) * PREVIEW_BLOCK_BYTES;

/** The record of tile (`tx`, `ty`) in a `width` × `height` block level file: its first byte and
 *  its length. */
export function tileRecord(width: number, height: number, tx: number, ty: number) {
  const across = spans(width),
    down = spans(height);
  const blocks = sum(down, ty) * sum(across) + down[ty] * sum(across, tx);
  return {
    offset: blocks * PREVIEW_BLOCK_BYTES,
    bytes: across[tx] * down[ty] * PREVIEW_BLOCK_BYTES,
  };
}
