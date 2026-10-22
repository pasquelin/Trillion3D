import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../sdk-core/src/contracts/bloomOptions.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { chainSizes, hdrChainBytes } from '../filters/levelSizes.ts'
import { BLURRED_LEVEL, GRID_DEPTH, GRID_TILE } from './finishLayout.ts'

/**
 * Bytes the display finishing holds for an image of `width × height` pixels, at most: the scene's
 * half-size image and its levels, and the local exposure's grid, log luminance and blur targets
 * (`createFinish`). Every level, the blur targets as wide as their image: the reserve a view
 * makes for it (`../effects/targets.ts`).
 */
export function finishBytesAt(width: number, height: number) {
  const sizes = chainSizes(width, height, BLOOM_LEVEL_COUNT)
  const [gridWidth, gridHeight] = sizes[0].map((n) => ceilDiv(n, GRID_TILE))
  const [w, h] = sizes[BLURRED_LEVEL]
  const grid = textureBytesOf({
    size: { width: gridWidth, height: gridHeight, depthOrArrayLayers: GRID_DEPTH },
    dimension: '3d',
    format: 'rgba16float',
  })
  const log = textureBytesOf({ size: { width: w, height: h }, format: 'r16float' })
  return hdrChainBytes(width, height) + (grid ?? 0) + 3 * (log ?? 0)
}
