import { PREVIEW_BLOCK_BYTES, levelBlockBytes } from '../sdk-core/index.ts';
import { levelSize, type TilePlace } from './textureTiles.ts';
import { cellOrigin, tailOrigin, type TileRegion } from './webgpuTileWrite.ts';

/**
 * Gestures that post block-compressed texels into a pool tile: the same rectangles as
 * `webgpuTileWrite.ts`, in whole 4×4 blocks. A region's origin is already a multiple of four —
 * tiles and gutters are —, its extent is rounded up to the block that contains its last texel,
 * which the level's padded bytes hold; and every destination lies inside the cell, gutter
 * included. A block copy into the middle of a pool cannot stop mid-block: WebGPU refuses it.
 * A level whose bytes are not the whole blocks its dimensions imply is refused here, once, for
 * tiles and tails alike.
 */
const blocksAcross = (width: number) => Math.ceil(width / 4);
const roundUp = (texels: number) => blocksAcross(texels) * 4;

/** Refuses a level whose bytes are not the whole blocks its dimensions imply — checked before a
 *  tile is placed, so a short or foreign file never occupies a slot with whatever it held. */
export function checkLevelBlocks(blocks: Uint8Array, [width, height]: readonly [number, number]) {
  if (blocks.byteLength !== levelBlockBytes(width, height))
    throw new Error(`TEXTURE_LEVEL_BYTES ${width}x${height}: ${blocks.byteLength}`);
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
  checkLevelBlocks(blocks, level);
  const [levelWidth, levelHeight] = level;
  const rowBlocks = blocksAcross(levelWidth);
  const width = Math.min(roundUp(region.width), roundUp(levelWidth) - region.sx);
  const height = Math.min(roundUp(region.height), roundUp(levelHeight) - region.sy);
  queue.writeTexture(
    { texture, origin },
    blocks as Uint8Array<ArrayBuffer>,
    {
      offset: ((region.sy / 4) * rowBlocks + region.sx / 4) * PREVIEW_BLOCK_BYTES,
      bytesPerRow: rowBlocks * PREVIEW_BLOCK_BYTES,
      rowsPerImage: height / 4,
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
    writeBlocks(queue, pool, tailOrigin(place, rank), blocks, level, {
      sx: 0,
      sy: 0,
      width,
      height,
    });
  });
}
