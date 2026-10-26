import { blocksAcross, previewLevelSize } from '../../../../sdk-core/src/texture/previewLevels.ts'
import { PREVIEW_BLOCK_SIDE } from '../../../../sdk-core/src/texture/previewFormat.ts'
import {
  tailOffset,
  tileSpanEnd,
  tileSpanStart,
  TILE_PITCH,
  type TilePlace,
} from '../texture/tiles.ts'
import { TILE_BORDER, TILE_SIZE } from '../../../../sdk-core/src/contracts/writtenFormats.ts'

/**
 * Gestures that post texels into a pool tile. Three sources, one draw: the tile receives its 128×128
 * texels and, around them, the gutter taken from neighbouring texels of the same level — clipped at
 * the image edge, where the shader bounds its read to the half-texel anyway.
 *
 * A cooked tile for the lossless lane arrives as its record's blocks decoded to RGBA8
 * (`../texture/blockDecode.ts`) and is written by `writeTexture`, its rows whole blocks wide; a
 * block lane's is written as blocks (`writeBlocks.ts`). The sidecar queue arrives as RGBA bytes and
 * is written by `writeTexture`. A host texture, with no cooked chain, goes through a working
 * texture whose mips the GPU built, copied level by level into the pool.
 */
export type TileRegion = {
  /** Origin and dimensions of the rectangle read in the source level. */
  sx: number
  sy: number
  width: number
  height: number
  /** Where this rectangle lands in the tile cell, gutter included. */
  dx: number
  dy: number
}

/** Rectangle of a tile in its level, gutter included, clipped at the image edge. */
export function tileRegion(levelWidth: number, levelHeight: number, tx: number, ty: number) {
  const x0 = tileSpanStart(tx),
    y0 = tileSpanStart(ty)
  const x1 = tileSpanEnd(levelWidth, tx),
    y1 = tileSpanEnd(levelHeight, ty)
  return {
    sx: x0,
    sy: y0,
    width: x1 - x0,
    height: y1 - y0,
    dx: x0 - tx * TILE_SIZE + TILE_BORDER,
    dy: y0 - ty * TILE_SIZE + TILE_BORDER,
  }
}

/** Origin of a pool cell, in texels. */
export const cellOrigin = (place: TilePlace) =>
  [place.x * TILE_PITCH, place.y * TILE_PITCH] as const
/** Origin of a tile's `region` in its pool cell: the cell's origin, the region's offset and the layer. */
export const regionOrigin = (place: TilePlace, region: TileRegion): GPUOrigin3D => {
  const [ox, oy] = cellOrigin(place)
  return [ox + region.dx, oy + region.dy, place.layer]
}
/** Origin of the `rank`-th queue level in its cell, border included. */
const tailOrigin = (place: TilePlace, rank: number): GPUOrigin3D => [
  place.x * TILE_PITCH + TILE_BORDER + tailOffset(rank),
  place.y * TILE_PITCH + TILE_BORDER,
  place.layer,
]

/** Writes texels at an origin of a texture: `width` × `height` of them, rows `pitch` texels apart
 *  — packed by default —, each `texelBytes` bytes: RGBA8 by default. */
export function writeTexels(
  queue: GPUQueue,
  texture: GPUTexture,
  origin: GPUOrigin3D,
  pixels: Uint8Array,
  width: number,
  height: number,
  pitch = width,
  texelBytes = 4,
) {
  queue.writeTexture(
    { texture, origin },
    pixels as Uint8Array<ArrayBuffer>,
    { bytesPerRow: pitch * texelBytes, rowsPerImage: height },
    { width, height },
  )
}

/** Texels of a `width` wide surface decoded from whole blocks: its rows are whole blocks wide. */
const decodedPitch = (width: number) => blocksAcross(width) * PREVIEW_BLOCK_SIDE

/** A tile's texels, `texelBytes` each: its region, to its cell — whole blocks wide when `decoded` (a
 *  record unpacked by `blockDecode.ts`, `blockDecodeMore.ts` or `floatTexels.ts`), else rows exactly
 *  its width (a half-float record, `../texture/tileRecords.ts`). */
export function writeTileTexels(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  texels: Uint8Array,
  region: TileRegion,
  texelBytes: number,
  decoded = true,
) {
  const { width, height } = region
  writeTexels(
    queue,
    pool,
    regionOrigin(place, region),
    texels,
    width,
    height,
    decoded ? decodedPitch(width) : width,
    texelBytes,
  )
}

export function copyTileFromTexture(
  encoder: GPUCommandEncoder,
  pool: GPUTexture,
  place: TilePlace,
  source: GPUTexture,
  level: number,
  region: TileRegion,
) {
  encoder.copyTextureToTexture(
    { texture: source, mipLevel: level, origin: [region.sx, region.sy, 0] },
    { texture: pool, origin: regionOrigin(place, region) },
    [region.width, region.height, 1],
  )
}

/** How a lane writes one tail level of `level` texels: its bytes checked, queued at `origin`. */
export type TailLevelWriter = (
  queue: GPUQueue,
  pool: GPUTexture,
  origin: GPUOrigin3D,
  bytes: Uint8Array,
  level: readonly [number, number],
) => void

/** A tail level of texels `texelBytes` each — one in the eight-bit channel pool, two or four in
 *  the float channel pools, eight or sixteen in the half-float lane —, rows packed. */
export const texelLevelWriter =
  (texelBytes: number): TailLevelWriter =>
  (queue, pool, origin, texels, [width, height]) => {
    if (texels.byteLength !== width * height * texelBytes) throw new Error('TEXTURE_TAIL_BYTES')
    writeTexels(queue, pool, origin, texels, width, height, width, texelBytes)
  }

/** Queue levels, from the first to 1×1, each at its place in the tile, by `writeLevel`. */
export function writeTail(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  size: [number, number],
  tail: number,
  levels: readonly Uint8Array[],
  writeLevel: TailLevelWriter,
) {
  levels.forEach((bytes, rank) =>
    writeLevel(
      queue,
      pool,
      tailOrigin(place, rank),
      bytes,
      previewLevelSize(size[0], size[1], tail + rank),
    ),
  )
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
    const [width, height] = previewLevelSize(size[0], size[1], level)
    encoder.copyTextureToTexture(
      { texture: source, mipLevel: level, origin: [0, 0, 0] },
      { texture: pool, origin: tailOrigin(place, level - tail) },
      [width, height, 1],
    )
  }
}
