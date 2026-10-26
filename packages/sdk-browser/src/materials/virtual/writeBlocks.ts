import { alignUp } from '../../../../math/src/scalar/integers.ts'
import { blocksAcross, levelBlockBytes } from '../../../../sdk-core/src/texture/previewLevels.ts'
import {
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_SIDE,
  previewLayoutBlockBytes,
} from '../../../../sdk-core/src/texture/previewFormat.ts'
import type { TilePlace } from '../texture/tiles.ts'
import { LevelBytesError } from '../texture/heldLevels.ts'
import { regionOrigin, type TailLevelWriter, type TileRegion } from './write.ts'

/**
 * Gestures that post block-compressed texels into a pool tile: the same rectangles as
 * `write.ts`, in whole 4×4 blocks. A region's origin is already a multiple of four — tiles and
 * gutters are —, its extent is rounded up to the block that contains its last texel, which the
 * record's or the tail level's padded bytes hold; and every destination lies inside the cell,
 * gutter included. A block copy into the middle of a pool cannot stop mid-block: WebGPU refuses it.
 * Bytes that are not the whole blocks their dimensions imply are refused once per path: a streamed
 * tile's where its read resolves (`../texture/blockFormats.ts`), a tail's level here.
 */

/** Refuses a tail level whose bytes are not the whole blocks its dimensions imply. */
function checkLevelBlocks(
  blocks: Uint8Array,
  size: readonly [number, number],
  blockBytes = PREVIEW_BLOCK_BYTES,
) {
  if (blocks.byteLength !== levelBlockBytes(size[0], size[1], blockBytes))
    throw new LevelBytesError(size, blocks.byteLength)
}

/** Copies whole blocks — `width` × `height` texels, rows packed — to `origin`. */
function writeBlocks(
  queue: GPUQueue,
  texture: GPUTexture,
  origin: GPUOrigin3D,
  blocks: Uint8Array,
  [width, height]: readonly [number, number],
  blockBytes = PREVIEW_BLOCK_BYTES,
) {
  queue.writeTexture(
    { texture, origin },
    blocks as Uint8Array<ArrayBuffer>,
    {
      offset: 0,
      bytesPerRow: blocksAcross(width) * blockBytes,
      rowsPerImage: blocksAcross(height),
    },
    { width: alignUp(width, PREVIEW_BLOCK_SIDE), height: alignUp(height, PREVIEW_BLOCK_SIDE) },
  )
}

/** A tile's record (`../texture/tileRecords.ts`): its region's blocks, alone, to its cell — of
 *  `blockBytes` each: sixteen, or BC4's eight. */
export function writeTileFromBlocks(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  record: Uint8Array,
  region: TileRegion,
  blockBytes = PREVIEW_BLOCK_BYTES,
) {
  writeBlocks(
    queue,
    pool,
    regionOrigin(place, region),
    record,
    [region.width, region.height],
    blockBytes,
  )
}

/** A block-compressed tail level, at its block-aligned place (`writeTail`). */
export const writeBlocksLevel: TailLevelWriter = (queue, pool, origin, blocks, level) => {
  checkLevelBlocks(blocks, level)
  writeBlocks(queue, pool, origin, blocks, level)
}

/** A BC4 tail level: blocks of eight bytes. */
export const writeBc4Level: TailLevelWriter = (queue, pool, origin, blocks, level) => {
  const blockBytes = previewLayoutBlockBytes('one-channel')
  checkLevelBlocks(blocks, level, blockBytes)
  writeBlocks(queue, pool, origin, blocks, level, blockBytes)
}
