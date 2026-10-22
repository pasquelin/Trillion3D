/**
 * The bloom's levels, on the CPU: how big each is, which of them draw, and what they hold. The
 * image is brought to half size, then down five more halvings, each level the one above's 4 × 4
 * mean (`../../filters/downsampleChain.ts`); a level whose size is 0 is left out, and each that
 * draws is blurred over `size × sizeScale` percent of its width and summed into the next larger
 * level's, tinted (`webgpuBloom.ts`, `bloomSet.ts`).
 */
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import { hdrChainBytes } from '../../filters/levelSizes.ts'

/** The size under which a level is left out: it blurs nothing. */
export const BLOOM_LEVEL_LEAST = 1e-8

/** The scale of every level's tint: the glow's `intensity` over the levels, each carrying an equal
 *  share of it. */
export const bloomTintScale = (intensity: number) => intensity / BLOOM_LEVEL_COUNT

/** Bytes a bloom holds for an image of `width × height` pixels, at most: the image after its
 *  setup and the five levels under it, and the two targets of each level's blur, as wide as the
 *  level — 3 texels of `HDR_FORMAT` per texel of the levels. */
export const bloomBytes = (width: number, height: number) => 3 * hdrChainBytes(width, height)
