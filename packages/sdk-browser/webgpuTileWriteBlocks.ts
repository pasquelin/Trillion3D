import { PREVIEW_BLOCK_BYTES, levelBlockBytes } from '../sdk-core/index.ts';
import { levelSize, tailOffset, TILE_BORDER, TILE_PITCH, type TilePlace } from './textureTiles.ts';
import type { TextureLevelBlocks } from './textureLevelReader.ts';
import type { TileRegion } from './webgpuTileWrite.ts';

/**
 * Gestures that post block-compressed texels into a pool tile: the same rectangles as
 * `webgpuTileWrite.ts`, in whole 4×4 blocks. A region's origin is already a multiple of four —
 * tiles and gutters are —, its extent is rounded up to the block that contains its last texel,
 * which the level's padded bytes hold; and every destination lies inside the cell, gutter
 * included. A block copy into the middle of a pool cannot stop mid-block: WebGPU refuses it.
 */
const blocksAcross = (width: number) => Math.ceil(width / 4);
const roundUp = (texels: number) => blocksAcross(texels) * 4;

/** Copies the block rows of `region` out of `level` to `origin`. */
function writeBlocks(
  queue: GPUQueue,
  texture: GPUTexture,
  origin: GPUOrigin3D,
  level: TextureLevelBlocks,
  region: Pick<TileRegion, 'sx' | 'sy' | 'width' | 'height'>,
) {
  const rowBlocks = blocksAcross(level.width);
  const width = Math.min(roundUp(region.width), roundUp(level.width) - region.sx);
  const height = Math.min(roundUp(region.height), roundUp(level.height) - region.sy);
  queue.writeTexture(
    { texture, origin },
    level.blocks as Uint8Array<ArrayBuffer>,
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
  level: TextureLevelBlocks,
  region: TileRegion,
) {
  const origin: GPUOrigin3D = [
    place.x * TILE_PITCH + region.dx,
    place.y * TILE_PITCH + region.dy,
    place.layer,
  ];
  writeBlocks(queue, pool, origin, level, region);
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
    const [width, height] = levelSize(size[0], size[1], tail + rank);
    if (blocks.byteLength !== levelBlockBytes(width, height)) throw new Error('TEXTURE_TAIL_BYTES');
    const origin: GPUOrigin3D = [
      place.x * TILE_PITCH + TILE_BORDER + tailOffset(rank),
      place.y * TILE_PITCH + TILE_BORDER,
      place.layer,
    ];
    writeBlocks(queue, pool, origin, { blocks, width, height }, { sx: 0, sy: 0, width, height });
  });
}
