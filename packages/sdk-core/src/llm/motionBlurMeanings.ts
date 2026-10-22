import {
  MOTION_BLUR_PRESET_LEVELS,
  MOTION_BLUR_SAMPLES,
  type MotionBlurField,
} from '../contracts/motionBlurOptions.ts'

/** The samples a pixel gathers at each running level (`MOTION_BLUR_SAMPLES`). */
const samples = Object.entries(MOTION_BLUR_SAMPLES)
  .map(([level, count]) => `${level} ${count}`)
  .join(', ')

/** What the quality levels write of `field`, by the table the runtime reads (`MOTION_BLUR_PRESET_LEVELS`). */
const written = (field: keyof (typeof MOTION_BLUR_PRESET_LEVELS)['smooth']) =>
  Object.entries(MOTION_BLUR_PRESET_LEVELS)
    .map(([level, values]) => `${String(values[field])} at '${level}'`)
    .join(', ')

/** What each setting of how the motion blur is drawn means (`../contracts/motionBlurOptions.ts`);
 *  the blur's strength, longest streak and frame rate are the effect chain's (`effect.motionBlur`). */
export const MOTION_BLUR_MEANINGS: Readonly<Record<MotionBlurField, string>> = {
  motionBlurQuality: `The quality of the motion blur, which fixes how many samples a pixel gathers along its streak: off draws none, ${samples} (veryHigh the default). The quality levels write ${written('motionBlurQuality')}.`,
  motionBlurHalfResGather: `Whether a tile whose streak is longer, in pixels, than the samples a pixel takes is gathered at half the resolution of the image; false by default. The quality levels write ${written('motionBlurHalfResGather')}.`,
  motionBlurHalfResInput:
    'Whether the samples of a streak spaced more than a pixel apart read the half-resolution image, wholly so from two pixels apart, so that the few samples cover the whole streak without gaps.',
  motionBlurSeparable:
    "Whether the blur runs twice, the second pass smoothing the first one's grain and reading the full-size image alone; costs one more pass.",
  motionBlurScatter:
    'Whether the largest motion of each tile is always spread over the tiles it crosses by drawing it, rather than by reading the neighbours; a streak of more than three tiles of 16 pixels needs it anyway.',
  motionBlurDirections:
    'How many motions a tile keeps and a pixel gathers along, 1 or 2 (1 by default): with 2, a pixel of a tile where two different motions cross is gathered along both and the gaps of either are filled from the other; a tile with one motion is blurred as with 1. Costs one more tile image and list, and more passes.',
}
