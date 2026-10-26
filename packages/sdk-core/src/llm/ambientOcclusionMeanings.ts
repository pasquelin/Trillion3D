import {
  AMBIENT_OCCLUSION_PRESET_LEVELS,
  type AmbientOcclusionField,
} from '../contracts/ambientOcclusionOptions.ts'
import { presetWritten } from './schemaParts.ts'

/** What the quality levels write of `field`, by the table the runtime reads (`AMBIENT_OCCLUSION_PRESET_LEVELS`). */
const written = (field: AmbientOcclusionField) =>
  presetWritten(AMBIENT_OCCLUSION_PRESET_LEVELS, field)

/** What each setting of the screen-space ambient occlusion means (`../contracts/ambientOcclusionOptions.ts`,
 *  `../contracts/ambientOcclusionHorizon.ts`); it applies to the lit image where no global illumination is on. The defaults
 *  and the ranges are the schema's own. */
export const AMBIENT_OCCLUSION_MEANINGS: Readonly<Record<AmbientOcclusionField, string>> =
  /* @__PURE__ */ (() => ({
    ambientOcclusion:
      "The master switch of the screen-space ambient occlusion: the contact shadow a crease, a corner or the foot of a wall casts on the light that comes from all round, found in the depth the image drew. It darkens a surface's emission and the sky light's diffuse, never a declared light, and only where the bounce (the global illumination) is off: with it on, the screen probes carry their own short-range occlusion. false draws none.",
    ambientOcclusionIntensity:
      'How much of the occlusion shows, from 0 (none: off) to 1 (all of it).',
    ambientOcclusionStaticFraction:
      "The share of what the base pass left in the picture — a surface's emission — that the occlusion darkens, from 0 to 1.",
    ambientOcclusionRadius:
      'How far from a point, in metres, a surface may be and occlude it. By default it is the radius at 4 m from the eye and grows with the distance, so that its share of the image holds; with ambientOcclusionRadiusInWorldSpace it is the radius in the world at any distance.',
    ambientOcclusionRadiusInWorldSpace:
      "Whether the radius is the world's, in metres, rather than the view's, which is the radius at 4 m from the eye and grows with the distance.",
    ambientOcclusionFadeDistance:
      'The distance from the eye, in metres, where the occlusion has faded to nothing, so that far surfaces take none.',
    ambientOcclusionFadeRadius:
      'How many metres before ambientOcclusionFadeDistance the occlusion starts to fade.',
    ambientOcclusionPower:
      'The exponent the occlusion is raised to: more makes the occluded corners darker and the rest lighter.',
    ambientOcclusionBias:
      'How far a point is lifted off its surface along its normal before the search, in thousandths of its depth: more avoids self-occlusion on slopes and shows less of a crease.',
    ambientOcclusionQuality: `The quality the search runs at, from 0 to 100: it picks how many resolutions the disc search runs at (1 below 35, 2 below 70, 3 over) and how many samples a pixel takes, the steps of the horizon search's directions. The ceiling ambientOcclusionMaxQuality holds it down, ambientOcclusionLevels sets the resolutions itself.`,
    ambientOcclusionMipBlend:
      'How much of the coarser resolution is blended into the finer one, from 0.1 to 1.',
    ambientOcclusionMipScale:
      'How the radius grows over each coarser resolution, a factor of at least 0.5; larger spreads the occlusion wider at the coarser levels.',
    ambientOcclusionMipThreshold:
      "The depth step, per centimetre and over the resolution, under which the neighbours that the coarser levels' setup halves count as one surface.",
    ambientOcclusionLevels: `The resolutions the search runs at: 1 to 3, 0 none (no occlusion); -1 follows the quality. The quality levels write ${written('ambientOcclusionLevels')}.`,
    ambientOcclusionMaxQuality: `A ceiling on the quality, from 0 to 100; 100 holds none, and a negative value forces the quality its absolute value names. The quality levels write ${written('ambientOcclusionMaxQuality')}.`,
    ambientOcclusionMipLevelFactor: `How fast the samples of the search climb the depth pyramid's coarser levels along the search; 0 reads the finest level only, and 1 or less never leaves it. The quality levels write ${written('ambientOcclusionMipLevelFactor')}.`,
    ambientOcclusionRadiusScale: `A scale on the radius, from 0.1 to 15. The quality levels write ${written('ambientOcclusionRadiusScale')}.`,
    ambientOcclusionWithScreenProbes:
      "Whether the occlusion is also drawn where the bounce lights the pixels (the world's probes and the screen probes), occluding their light: it applies only when the screen probes' own short-range occlusion (screenProbeShortRangeOcclusion) is off; false by default, the probes' occlusion alone is used.",
    ambientOcclusionCompute:
      "How the disc search is made, from 0 to 3: 0 the pixel passes of the quality's resolutions (the default); 1 to 3 the single compute pass, which makes one resolution at most, takes the normals the depth gives rather than the surfaces' own and blurs nothing among a quad of pixels. 2 and 3 name an asynchronous queue that a browser device does not have: all three make the same pass. The horizon method reads none of it.",
    ambientOcclusionComputeSmooth:
      'Whether the compute pass is smoothed, a box of four taps two texels apart, in an image that does not accumulate in time (the noise it leaves would show); true by default. It applies only where ambientOcclusionCompute is 1 or more.',
    ambientOcclusionMethod:
      "The method that finds the occlusion: 'disc' (the default) samples a disc round each pixel at one to three resolutions and counts what rises above the surface; 'horizon' searches, along a few directions in the image, the highest horizon each side of the pixel, integrates the sky that is left against the normal, and filters the result in space and in time. The horizon method has its own settings, ambientOcclusionHorizon…, and its own radius.",
    ambientOcclusionHorizonNormals:
      "Whether the horizon method reads the surfaces' own normals rather than the normals the depth gives; false by default.",
    ambientOcclusionHorizonFilterWidth:
      "The side, in pixels, of the horizon method's spatial filter: 3 and 4 as they are, any other number the five-wide filter; each neighbour is weighed by how near it lies to the pixel's plane.",
    ambientOcclusionHorizonThickness:
      'How thick the horizon method takes a surface to be (any number: it is squared): more lowers the occlusion a thin surface casts (where a sample lies under the horizon found so far, the horizon sinks towards it by the square of this share).',
    ambientOcclusionHorizonRadius:
      'The distance, in metres, from 0, at which an occluder stops counting for the horizon method: its own radius, which the disc search does not read.',
    ambientOcclusionHorizonAngles: `How many directions the horizon method searches round a pixel, from 1 to 16, spread over half a turn: more is smoother and dearer. The quality levels write ${written('ambientOcclusionHorizonAngles')}.`,
    ambientOcclusionHorizonPauseJitter:
      'Whether the directions the horizon method searches stop turning from image to image (the history then blends the same samples): false by default.',
    ambientOcclusionHorizonDownsample:
      "Whether the horizon method searches at half the image's size, the result upsampled at the end: cheaper, softer; false by default.",
    ambientOcclusionHorizonTemporal:
      "Whether the horizon method's result is blended into the last image's, clamped to the neighbourhood of this one: true by default.",
    ambientOcclusionHorizonSpatial:
      "Whether the horizon method's result is blurred in space, each neighbour weighed by how near it lies to the pixel's plane: true by default. The power and the intensity apply either way: in the filter, or, with it off, in the last pass of the method.",
    ambientOcclusionHorizonBlend:
      "The share of this image the horizon method's temporal filter takes, from 0 (the history alone); the rest is the history's.",
  }))()
