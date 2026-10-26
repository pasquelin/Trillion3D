import {
  GAUSSIAN_BLUR_PRESET_LEVELS,
  type GaussianBlurField,
} from '../contracts/gaussianBlurRules.ts'
import { presetSentence } from './schemaParts.ts'

/** The quality levels' sentence for `field`: what they write of it (`GAUSSIAN_BLUR_PRESET_LEVELS`). */
const written = (field: GaussianBlurField) => presetSentence(GAUSSIAN_BLUR_PRESET_LEVELS, field)

/** What each setting of how the Gaussian blur is drawn means (`../contracts/gaussianBlurRules.ts`): the
 *  blur of the bloom's six levels and of the local exposure's blurred luminance. */
export const GAUSSIAN_BLUR_MEANINGS: Readonly<Record<GaussianBlurField, string>> =
  /* @__PURE__ */ (() => ({
    gaussianFastBlurThreshold: `The radius, in texels, from which a Gaussian blur writes its first pass at half the width, the second pass reading it bilinearly: a cheaper pass of a blur a little softer along x, which shows more the narrower the blur. 0 halves every blur, a radius under the threshold none; 100, the default, halves none of a 1080p image's. ${written('gaussianFastBlurThreshold')}`,
    gaussianSampleScale: `The reach of a Gaussian blur's kernel as a multiple of its radius, from 0.1 to 10, 1 by default: the weights are those of the radius, so under 1 the kernel is cut short, fewer reads, cheaper, with artefacts on bright light, and over 1 it reads further out. ${written('gaussianSampleScale')}`,
    gaussianLoopMode:
      "The most reads of a Gaussian blur's pass: 0, the default, limits it to 32, a kernel of 63 texels at most; 1 and 2 raise it to 128. The two last are the same here, every pass being one loop over the reads it holds.",
  }))()
