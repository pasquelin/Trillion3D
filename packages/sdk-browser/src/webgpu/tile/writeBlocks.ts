import {
  blocksAcross,
  levelBlockBytes,
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_SIDE,
} from '../../../../sdk-core/src/index.ts';
import { levelSize, type TilePlace } from '../../texture/tiles.ts';
import { cellOrigin, tailOrigin, type TileRegion } from './write.ts';

/**
 * Gestures that post block-compressed texels into a pool tile: the same rectangles as
 * `write.ts`, in whole 4×4 blocks. A region's origin is already a multiple of four —
 * tiles and gutters are —, its extent is rounded up to the block that contains its last texel,
 * which the level's padded bytes hold; and every destination lies inside the cell, gutter
 * included. A block copy into the middle of a pool cannot stop mid-block: WebGPU refuses it.
 * A level whose bytes are not the whole blocks its dimensions imply is refused once per path:
 * a streamed level where its read resolves (`levels.ts`), a tail's level here.
 */
const roundUp = (texels: number) => blocksAcross(texels) * PREVIEW_BLOCK_SIDE;

/** A short or foreign level file: its bytes are not the whole blocks its dimensions imply. */
export class LevelBytesError extends Error {
  constructor([width, height]: readonly [number, number], bytes: number) {
    super(`TEXTURE_LEVEL_BYTES ${width}x${height}: ${bytes}`);
  }
}

/** Refuses a level whose bytes are not the whole blocks its dimensions imply — checked before
 *  the level is held or a tile placed, so such a file never occupies a slot with what it held. */
export function checkLevelBlocks(blocks: Uint8Array, size: readonly [number, number]) {
  if (blocks.byteLength !== levelBlockBytes(size[0], size[1]))
    throw new LevelBytesError(size, blocks.byteLength);
}

/** Copies the block rows of `region` out of a `width` × `height` level to `origin`. */
function writeBlocks(
  queue: GPUQueue,
  texture: GPUTexture,
  origin: GPUOrigin3D,
  blocks: Uint8Array,
  level: readonly [number, number],
  region: Pick<TileRegion, 'sx' | 'sy' | 'width' | 'height'>,
) {
  const [levelWidth, levelHeight] = level;
  const rowBlocks = blocksAcross(levelWidth);
  const width = Math.min(roundUp(region.width), roundUp(levelWidth) - region.sx);
  const height = Math.min(roundUp(region.height), roundUp(levelHeight) - region.sy);
  queue.writeTexture(
    { texture, origin },
    blocks as Uint8Array<ArrayBuffer>,
    {
      offset:
        ((region.sy / PREVIEW_BLOCK_SIDE) * rowBlocks + region.sx / PREVIEW_BLOCK_SIDE) *
        PREVIEW_BLOCK_BYTES,
      bytesPerRow: rowBlocks * PREVIEW_BLOCK_BYTES,
      rowsPerImage: height / PREVIEW_BLOCK_SIDE,
    },
    { width, height },
  );
}

export function writeTileFromBlocks(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  blocks: Uint8Array,
  level: readonly [number, number],
  region: TileRegion,
) {
  const [ox, oy] = cellOrigin(place);
  writeBlocks(queue, pool, [ox + region.dx, oy + region.dy, place.layer], blocks, level, region);
}

/** Queue levels, from the first to 1×1, each at its block-aligned place in the tile. */
export function writeTailFromBlocks(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  size: [number, number],
  tail: number,
  levels: readonly Uint8Array[],
) {
  levels.forEach((blocks, rank) => {
    const level = levelSize(size[0], size[1], tail + rank);
    const [width, height] = level;
    checkLevelBlocks(blocks, level);
    writeBlocks(queue, pool, tailOrigin(place, rank), blocks, level, {
      sx: 0,
      sy: 0,
      width,
      height,
    });
  });
}
