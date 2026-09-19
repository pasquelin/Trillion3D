import {
  levelSize,
  tailOffset,
  TILE_BORDER,
  TILE_PITCH,
  TILE_SIZE,
  type TilePlace,
} from './textureTiles.ts';

/**
 * Gestures that post texels into a pool tile. Three sources, one draw: the tile receives its 128×128
 * texels and, around them, the gutter taken from neighbouring texels of the same level — clipped at
 * the image edge, where the shader bounds its read to the half-texel anyway.
 *
 * A cooked level arrives decoded by the browser and is copied by `copyExternalImageToTexture`, the
 * same path full resolution took — same bytes, same conversion. The sidecar queue arrives as RGBA
 * bytes and is written by `writeTexture`. A host texture, with no cooked chain, goes through a
 * working texture whose mips the GPU built, copied level by level into the pool.
 */
export type TileRegion = {
  /** Origin and dimensions of the rectangle read in the source level. */
  sx: number;
  sy: number;
  width: number;
  height: number;
  /** Where this rectangle lands in the tile cell, gutter included. */
  dx: number;
  dy: number;
};

/** Rectangle of a tile in its level, gutter included, clipped at the image edge. */
export function tileRegion(levelWidth: number, levelHeight: number, tx: number, ty: number) {
  const x0 = Math.max(0, tx * TILE_SIZE - TILE_BORDER),
    y0 = Math.max(0, ty * TILE_SIZE - TILE_BORDER);
  const x1 = Math.min(levelWidth, (tx + 1) * TILE_SIZE + TILE_BORDER),
    y1 = Math.min(levelHeight, (ty + 1) * TILE_SIZE + TILE_BORDER);
  return {
    sx: x0,
    sy: y0,
    width: x1 - x0,
    height: y1 - y0,
    dx: x0 - tx * TILE_SIZE + TILE_BORDER,
    dy: y0 - ty * TILE_SIZE + TILE_BORDER,
  };
}

/** Origin of a pool cell, in texels. */
export const cellOrigin = (place: TilePlace) =>
  [place.x * TILE_PITCH, place.y * TILE_PITCH] as const;
/** Origin of the `rank`-th queue level in its cell, border included. */
const tailOrigin = (place: TilePlace, rank: number): GPUOrigin3D => [
  place.x * TILE_PITCH + TILE_BORDER + tailOffset(rank),
  place.y * TILE_PITCH + TILE_BORDER,
  place.layer,
];

/** Writes packed RGBA8 texels at an origin of a texture. */
export function writeRgba(
  queue: GPUQueue,
  texture: GPUTexture,
  origin: GPUOrigin3D,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  queue.writeTexture(
    { texture, origin },
    pixels as Uint8Array<ArrayBuffer>,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height },
  );
}

export function writeTileFromBitmap(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  bitmap: ImageBitmap,
  region: TileRegion,
) {
  const [ox, oy] = cellOrigin(place);
  queue.copyExternalImageToTexture(
    { source: bitmap, origin: [region.sx, region.sy] },
    { texture: pool, origin: [ox + region.dx, oy + region.dy, place.layer] },
    [region.width, region.height],
  );
}

export function copyTileFromTexture(
  encoder: GPUCommandEncoder,
  pool: GPUTexture,
  place: TilePlace,
  source: GPUTexture,
  level: number,
  region: TileRegion,
) {
  const [ox, oy] = cellOrigin(place);
  encoder.copyTextureToTexture(
    { texture: source, mipLevel: level, origin: [region.sx, region.sy, 0] },
    { texture: pool, origin: [ox + region.dx, oy + region.dy, place.layer] },
    [region.width, region.height, 1],
  );
}

/** Queue levels, from the first to 1×1, each at its place in the tile. */
export function writeTailFromBytes(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  size: [number, number],
  tail: number,
  levels: readonly Uint8Array[],
) {
  levels.forEach((pixels, rank) => {
    const [width, height] = levelSize(size[0], size[1], tail + rank);
    if (pixels.byteLength !== width * height * 4) throw new Error('TEXTURE_TAIL_BYTES');
    writeRgba(queue, pool, tailOrigin(place, rank), pixels, width, height);
  });
}

export function copyTailFromTexture(
  encoder: GPUCommandEncoder,
  pool: GPUTexture,
  place: TilePlace,
  source: GPUTexture,
  size: [number, number],
  tail: number,
  last: number,
) {
  for (let level = tail; level <= last; level++) {
    const [width, height] = levelSize(size[0], size[1], level);
    encoder.copyTextureToTexture(
      { texture: source, mipLevel: level, origin: [0, 0, 0] },
      { texture: pool, origin: tailOrigin(place, level - tail) },
      [width, height, 1],
    );
  }
}
