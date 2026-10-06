import {
  blocksAcross,
  levelBlockBytes,
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_SIDE,
} from '../../../../sdk-core/src/index.ts'
import { levelSize, type TilePlace } from '../../texture/tiles.ts'
import { LevelBytesError } from '../../texture/heldLevels.ts'
import { cellOrigin, tailOrigin, type TileRegion } from './write.ts'

/**
 * Gestures that post block-compressed texels into a pool tile: the same rectangles as
 * `write.ts`, in whole 4×4 blocks. A region's origin is already a multiple of four — tiles and
 * gutters are —, its extent is rounded up to the block that contains its last texel, which the
 * record's or the tail level's padded bytes hold; and every destination lies inside the cell,
 * gutter included. A block copy into the middle of a pool cannot stop mid-block: WebGPU refuses it.
 * Bytes that are not the whole blocks their dimensions imply are refused once per path: a streamed
 * tile's where its read resolves (`../../texture/blockFormats.ts`), a tail's level here.
 */
const roundUp = (texels: number) => blocksAcross(texels) * PREVIEW_BLOCK_SIDE

/** Refuses a tail level whose bytes are not the whole blocks its dimensions imply. */
function checkLevelBlocks(blocks: Uint8Array, size: readonly [number, number]) {
  if (blocks.byteLength !== levelBlockBytes(size[0], size[1]))
    throw new LevelBytesError(size, blocks.byteLength)
}

/** Copies whole blocks — `width` × `height` texels, rows packed — to `origin`. */
function writeBlocks(
  queue: GPUQueue,
  texture: GPUTexture,
  origin: GPUOrigin3D,
  blocks: Uint8Array,
  [width, height]: readonly [number, number],
) {
  queue.writeTexture(
    { texture, origin },
    blocks as Uint8Array<ArrayBuffer>,
    {
      offset: 0,
      bytesPerRow: blocksAcross(width) * PREVIEW_BLOCK_BYTES,
      rowsPerImage: blocksAcross(height),
    },
    { width: roundUp(width), height: roundUp(height) },
  )
}

/** A tile's record (`../../texture/tileRecords.ts`): its region's blocks, alone, to its cell. */
export function writeTileFromBlocks(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  record: Uint8Array,
  region: TileRegion,
) {
  const [ox, oy] = cellOrigin(place)
  const origin = [ox + region.dx, oy + region.dy, place.layer]
  writeBlocks(queue, pool, origin, record, [region.width, region.height])
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
    const level = levelSize(size[0], size[1], tail + rank)
    checkLevelBlocks(blocks, level)
    writeBlocks(queue, pool, tailOrigin(place, rank), blocks, level)
  })
}
