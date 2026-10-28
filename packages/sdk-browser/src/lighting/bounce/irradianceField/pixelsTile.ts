import { reverseBits32 } from '../../../../../math/src/scalar/bits.ts'
import { nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'

/** The bits of `value` taken from the even places of a Morton code, packed (the reference's `ReverseMortonCode2`). */
function compactBits(value: number) {
  let x = value & 0x55555555
  x = (x ^ (x >>> 1)) & 0x33333333
  x = (x ^ (x >>> 2)) & 0x0f0f0f0f
  x = (x ^ (x >>> 4)) & 0x00ff00ff
  x = (x ^ (x >>> 8)) & 0x0000ffff
  return x
}

/** The side of the tile of pixels one of which reports the interpolation misses (`irradianceFieldAdaptivePlacementFeedbackTileSize`): a power of two from 1 to 256. */
export const feedbackTileSize = (asked: number) => nextPow2(clamp(asked, 1, 256))

/**
 * The pixel of a tile of `tile` pixels a side that reports the misses at the frame `frame`: the frame's rank in the tile's `tile²` pixels, its bits reversed, the two coordinates the even and the odd
 * places of that address — every pixel of the tile reports in turn, spread over the tile (`GetFeedbackBufferTileJitter`, `IrradianceFieldGather.cpp:374-386`).
 */
export function feedbackTileJitter(tile: number, frame: number): readonly [number, number] {
  const log2 = Math.log2(tile)
  if (log2 === 0) return [0, 0]
  const index = frame % (tile * tile)
  const address = reverseBits32(index) >>> (32 - 2 * log2)
  return [compactBits(address), compactBits(address >>> 1)]
}
