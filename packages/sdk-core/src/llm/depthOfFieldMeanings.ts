import {
  DEPTH_OF_FIELD_LEVELS,
  DEPTH_OF_FIELD_PRESET_LEVELS,
  type DepthOfFieldField,
} from '../contracts/depthOfFieldRules.ts'
import { presetSentence } from './schemaParts.ts'

/** The quality levels' sentence for `field`: what they write of it (`DEPTH_OF_FIELD_PRESET_LEVELS`). */
const written = (field: DepthOfFieldField) => presetSentence(DEPTH_OF_FIELD_PRESET_LEVELS, field)

/** What each setting of how the depth of field is drawn means (`../contracts/depthOfFieldRules.ts`); the lens, the
 *  focus and the camera are the effect's (`effect.depthOfField`). */
export const DEPTH_OF_FIELD_MEANINGS: Readonly<Record<DepthOfFieldField, string>> =
  /* @__PURE__ */ (() => ({
    depthOfFieldQuality: `Whether the depth of field draws, ${DEPTH_OF_FIELD_LEVELS.join(' or ')}: off draws none, whatever the effects hold; the quality of the draw is the settings below, which the quality levels write. ${written('depthOfFieldQuality')}`,
    depthOfFieldGatherDivisor: `The size the foreground, the background and the slight out of focus are gathered at, as a divisor of the image's: 2, half (the default), or 1, the full size.`,
    depthOfFieldAccumulator: `The accumulator of the gather: low (a cheaper one), high (sorts the samples by their depth, the default) or cinematic (also gathers the background in layers). ${written('depthOfFieldAccumulator')}`,
    depthOfFieldDistinctionLimit:
      'A bright, large circle that is not scattered but whose radius times its perceived brightness exceeds this is dropped from the gather, which lowers the noise of large bokeh and darkens them; 0, the default, keeps them.',
    depthOfFieldGatherBokeh: `Whether the gather draws the shape of the diaphragm's blades (off by default). ${written('depthOfFieldGatherBokeh')}`,
    depthOfFieldPostfilter: `The filter each gathered layer is cleaned by: none, the median or the maximum of each channel over 3 × 3 texels. ${written('depthOfFieldPostfilter')}`,
    depthOfFieldRingCount: `The rings of the gather's kernel, 3 to 5, which fix its samples: 1 + 4 · rings · (rings + 1). ${written('depthOfFieldRingCount')}`,
    depthOfFieldMaxMips:
      'The most mip levels of the setup the gather reads, which lowers the noise of a wide, sparse kernel; 4 by default.',
    depthOfFieldForegroundScatter: `How the bright highlights of the foreground are scattered as sprites rather than gathered: off, or added over the gather. ${written('depthOfFieldForegroundScatter')}`,
    depthOfFieldBackgroundScatter: `How those of the background are: off, added over the gather, or added and occluding the gather behind them (the default). ${written('depthOfFieldBackgroundScatter')}`,
    depthOfFieldScatterBokeh: `Whether a scattered sprite takes the diaphragm's shape (on by default). ${written('depthOfFieldScatterBokeh')}`,
    depthOfFieldScatterMinRadius:
      "The smallest circle radius scattered as a sprite, in texels of the gather's size, 3 or more; 3 by default.",
    depthOfFieldScatterMaxRatio: `The most pixel quads scattered, as a share of them all, 0 to 1; 0.1 by default. ${written('depthOfFieldScatterMaxRatio')}`,
    depthOfFieldScatterNeighborColor:
      'The linear colour a pixel must exceed over its neighbours that are already scattered to be scattered too; 10 by default. Too low scatters too little, too high scatters the highlights needlessly.',
    depthOfFieldRecombine: `The recombine's slight out of focus, whose samples are taken at the full size: off, low (12 pairs of samples) or high (16). ${written('depthOfFieldRecombine')}`,
    depthOfFieldRecombineBokeh:
      "Whether the recombine's slight out of focus takes the diaphragm's shape (off by default).",
    depthOfFieldRecombineMinBlur:
      'The smallest blur, in full-size pixels, the recombine draws when it does its slight out of focus; 0.1 by default.',
    depthOfFieldMaxForegroundRadius: `The largest foreground circle radius, as a share of the image's width; 0.025 by default. ${written('depthOfFieldMaxForegroundRadius')}`,
    depthOfFieldMaxBackgroundRadius: `The largest background circle radius, as a share of the image's width; 0.025 by default. ${written('depthOfFieldMaxBackgroundRadius')}`,
    depthOfFieldSlightFocusRejection:
      "Widens by this share the range the recombine's slight out of focus is held to, 0 to 0.125; 0, the default, holds it to the neighbourhood's range.",
    depthOfFieldTemporalQuality: `The quality of the temporal accumulation the setup goes through before the gather, so the blur is stable from image to image, low or high (the default): both read the history bicubically and bound it by the neighbourhood, high also works in a luma-chroma space. ${written('depthOfFieldTemporalQuality')}`,
    depthOfFieldBilateralStrength:
      "How far a circle of confusion that differs from the history's rejects the history in that accumulation, 0 to 1; 0, the default, none (stronger noise at the edge between foreground and background when raised, stronger ghosting there when 0).",
    depthOfFieldTemporalCurrentWeight:
      "The weight of the current image in that accumulation's history, 0 to 1; 0.04 by default. Low values blur and ghost, high values fail to hide the jitter.",
  }))()
