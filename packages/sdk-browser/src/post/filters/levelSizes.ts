import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../sdk-core/src/contracts/bloomOptions.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'

/** Half of `n` texels, rounded up, one at least. */
export const halfOf = (n: number) => Math.max(1, ceilDiv(n, 2))

/** The size of the level below one of `width × height` texels: half, rounded up, one at least,
 *  written into `into` — a new pair by default. */
export function halfSize(
  width: number,
  height: number,
  into: [number, number] = [0, 0],
): [number, number] {
  into[0] = halfOf(width)
  into[1] = halfOf(height)
  return into
}

/** The format of the half-size image the scene's chain reads (`sceneChain.ts`) where the motion blur
 *  writes it beside the blurred image or the chain draws it itself: the HDR images' of the effects
 *  chain. The temporal pass writes its own in the history's colour format (`halfImageBytes`,
 *  `../taa/historyShape.ts`); the chain samples either. */
export const HALF_IMAGE_FORMAT: GPUTextureFormat = HDR_FORMAT

/** The sizes of the `count` levels of an image of `width × height` texels: the half of it, then
 *  each the half of the one before. */
export function chainSizes(width: number, height: number, count: number) {
  const sizes = [halfSize(width, height)]
  while (sizes.length < count) sizes.push(halfSize(...sizes[sizes.length - 1]))
  return sizes
}

/** Bytes of the `BLOOM_LEVEL_COUNT` levels of an image of `width × height` texels, one `HDR_FORMAT`
 *  texel to each of theirs: what the scene's chain holds, and the unit the bloom's targets and the
 *  finishing's are counted in (`bloomBytes`, `finishBytesAt`). */
export function hdrChainBytes(width: number, height: number) {
  let bytes = 0
  for (const [w, h] of chainSizes(width, height, BLOOM_LEVEL_COUNT))
    bytes += textureBytesOf({ size: { width: w, height: h }, format: HDR_FORMAT }) ?? 0
  return bytes
}
