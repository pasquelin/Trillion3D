import type { DistanceFieldMip } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { MipState } from './atlasState.ts'
import { BRICK, BRICK_VOXELS } from './layout.ts'

/**
 * THE BRICKS OF A MIP, WRITTEN INTO THE ATLAS. A mip's bricks are stored one after the other, 8 × 8 × 8
 * bytes each; the atlas holds a brick at the cell its index in the atlas names, `x` along the
 * first axis fastest. The blocks a mip took are runs of consecutive indices, so the bricks of a
 * block that lie in one row of the atlas are one region of 8 rows deep and 8 slices high, written
 * by one call: the bricks' rows are interleaved as the region lays them out.
 */

/** A run of bricks of a mip that lie side by side in the atlas: the rank in the mip of the first,
 *  its index in the atlas, how many. */
export interface BrickRun {
  readonly first: number
  readonly index: number
  readonly count: number
}

/** The runs of `held`'s bricks, a block at a time, split where the atlas's row ends. */
export function* brickRuns(
  held: MipState,
  blockBricks: number,
  sizeXY: number,
): Generator<BrickRun> {
  for (let b = 0; b < held.blocks.length; b++) {
    let first = b * blockBricks
    const end = Math.min(first + blockBricks, held.bricks)
    let index = held.blocks[b] * blockBricks
    while (first < end) {
      const count = Math.min(end - first, sizeXY - (index % sizeXY))
      yield { first, index, count }
      first += count
      index += count
    }
  }
}

/** The bytes of `bricks` as words: a view when they are aligned, else a copy. */
export function wordsOf(bricks: Uint8Array) {
  if (bricks.byteOffset % 4 === 0)
    return new Uint32Array(bricks.buffer, bricks.byteOffset, bricks.byteLength >> 2)
  return new Uint32Array(bricks.slice().buffer)
}

/** The rows of `run`'s bricks, from the `source` words of the mip, in the order of the region. */
export function interleave(source: Uint32Array, run: BrickRun, out: Uint32Array) {
  const rowWords = BRICK / 4
  const brickWords = BRICK_VOXELS / 4
  for (let row = 0; row < BRICK * BRICK; row++)
    for (let k = 0; k < run.count; k++) {
      const from = (run.first + k) * brickWords + row * rowWords
      const to = (row * run.count + k) * rowWords
      out[to] = source[from]
      out[to + 1] = source[from + 1]
    }
}

/** Writes every brick of `mip`, held as `held`, into `texture`. */
export function writeBricks(
  queue: GPUQueue,
  texture: GPUTexture,
  mip: DistanceFieldMip,
  held: MipState,
  blockBricks: number,
  sizeXY: number,
  scratch: Uint32Array,
) {
  const source = wordsOf(mip.bricks)
  const plane = sizeXY * sizeXY
  for (const run of brickRuns(held, blockBricks, sizeXY)) {
    const words = (run.count * BRICK_VOXELS) / 4
    interleave(source, run, scratch)
    const cell = [
      run.index % sizeXY,
      Math.floor(run.index / sizeXY) % sizeXY,
      Math.floor(run.index / plane),
    ]
    queue.writeTexture(
      { texture, origin: { x: cell[0] * BRICK, y: cell[1] * BRICK, z: cell[2] * BRICK } },
      scratch.subarray(0, words) as Uint32Array<ArrayBuffer>,
      { bytesPerRow: run.count * BRICK, rowsPerImage: BRICK },
      { width: run.count * BRICK, height: BRICK, depthOrArrayLayers: BRICK },
    )
  }
}
