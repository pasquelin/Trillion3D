import { clamp } from '../../../math/src/scalar/reals.ts'
import { CENTIMETRES_PER_METRE } from '../page/format.ts'
import {
  ANY_NUMBER,
  choiceSetting as choice,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  type SettingValues,
  rulesOf,
} from './settingRules.ts'

/**
 * THE AMBIENT OCCLUSION'S SECOND METHOD, the horizon search (`ambientOcclusionMethod: 'horizon'`). The first, the disc search
 * (`./ambientOcclusionOptions.ts`, the default), samples a disc round each pixel and counts what rises above the surface. This
 * one reads, along a few directions in the image, the highest horizon each side of the pixel finds in the depth, and integrates
 * the sky that is left against the surface's normal, a cosine-weighted share of the hemisphere. Each direction is a search of a
 * few steps up the depth pyramid; the pixel's directions turn from image to image, and the result is filtered in space — a
 * five-by-five blur that weighs each neighbour by how near it lies to the pixel's plane — and in time — blended into the last
 * image's, which is clamped to the neighbourhood of this one —, then upsampled to the image's size by the least of four taps.
 *
 * Its reach is its own radius (`ambientOcclusionHorizonRadius`), not the disc search's; it reads the normals the depth
 * gives (`ambientOcclusionHorizonNormals` takes the surfaces' own), and the distance fade, the quality's shape (the steps of a
 * direction), the intensity and the power are the occlusion's (the power and the intensity are applied by the spatial filter,
 * or, with that filter off, by the last pass of the method: an unoccluded surface integrates to two over π, which the
 * power and the intensity bring back to one either way). Run-time settings, as `./settingRules.ts` says.
 */

/** The reference's centimetres: one metre of ours is this many. */
const CM = CENTIMETRES_PER_METRE

/** The methods the occlusion is found by, the default first. */
const AMBIENT_OCCLUSION_METHODS = ['disc', 'horizon'] as const
/** A method of the ambient occlusion. */
export type AmbientOcclusionMethod = (typeof AMBIENT_OCCLUSION_METHODS)[number]

/**
 * The rules of the method and of the horizon search, each with the reference's default:
 * - `ambientOcclusionMethod` (`'disc'`): the method that finds the occlusion;
 * - `ambientOcclusionHorizonNormals` (off): read the surfaces' own normals rather than the normals the depth gives;
 * - `ambientOcclusionHorizonFilterWidth` (5): the side of the spatial filter, in pixels — 3 and 4 as they are, any other number the five-wide one;
 * - `ambientOcclusionHorizonThickness` (0.5), any number: a bias that takes a surface for thin or thick — more lowers the occlusion a
 *   thin surface casts: where a sample lies under the horizon found so far, the horizon sinks towards it by the share `thickness²`;
 * - `ambientOcclusionHorizonRadius` (2 m), from 0: the distance at which an occluder stops counting;
 * - `ambientOcclusionHorizonAngles` (2), 1 to 16: the directions a pixel searches, spread over half a turn;
 * - `ambientOcclusionHorizonPauseJitter` (off): hold the directions' turn from image to image;
 * - `ambientOcclusionHorizonDownsample` (off): search at half the image's size, upsampled at the end;
 * - `ambientOcclusionHorizonTemporal` (on), `ambientOcclusionHorizonSpatial` (on): the two filters;
 * - `ambientOcclusionHorizonBlend` (0.1), from 0: the share of this image the temporal filter takes, the rest the history's.
 */
export const AMBIENT_OCCLUSION_HORIZON_RULES = /* @__PURE__ */ (() =>
  [
    choice('ambientOcclusionMethod', 'disc', AMBIENT_OCCLUSION_METHODS),
    flag('ambientOcclusionHorizonNormals', false),
    number('ambientOcclusionHorizonFilterWidth', 5, ANY_NUMBER),
    number('ambientOcclusionHorizonThickness', 0.5, ANY_NUMBER),
    nonNegative('ambientOcclusionHorizonRadius', 200 / CM),
    number('ambientOcclusionHorizonAngles', 2, [1, 16]),
    flag('ambientOcclusionHorizonPauseJitter', false),
    flag('ambientOcclusionHorizonDownsample', false),
    flag('ambientOcclusionHorizonTemporal', true),
    flag('ambientOcclusionHorizonSpatial', true),
    nonNegative('ambientOcclusionHorizonBlend', 0.1),
  ] as const)()

/** The values of those settings, every one set. */
export type AmbientOcclusionHorizonValues = SettingValues<
  ReturnType<typeof rulesOf<typeof AMBIENT_OCCLUSION_HORIZON_RULES>>
>

/** What the horizon search reads of the settings, its lengths in the centimetres the search works in. */
export interface HorizonSettings {
  /** The surfaces' own normals are read, rather than the depth's. */
  normals: boolean
  /** The spatial filter's reach each side of a pixel: its first and last offset, in pixels. */
  filterFirst: number
  filterLast: number
  /** The share of the horizon found so far that a lower sample leaves, `1 − thickness²` held from 0 to 0.99 (a thickness over 1 leaves none). */
  thickness: number
  radiusCm: number
  /** The directions a pixel searches (the count read as a whole number, the angle between them from this number itself). */
  angles: number
  pauseJitter: boolean
  /** The search's reduction: 1 at the image's size, 2 at half. */
  downscale: 1 | 2
  temporal: boolean
  spatial: boolean
  blend: number
}

/** The spatial filter's first and last offset for a `width`: a width of 3 reaches one pixel each side, 4 one before and two after, the others two each side. */
const filterReach = (width: number) =>
  width === 3 ? ([-1, 1] as const) : width === 4 ? ([-1, 2] as const) : ([-2, 2] as const)

/** The horizon search's numbers from the values: the filter's reach, the thickness the horizon keeps, the lengths in centimetres. */
export function resolveHorizon(values: AmbientOcclusionHorizonValues): HorizonSettings {
  const [filterFirst, filterLast] = filterReach(values.ambientOcclusionHorizonFilterWidth)
  const thickness = values.ambientOcclusionHorizonThickness
  return {
    normals: values.ambientOcclusionHorizonNormals,
    filterFirst,
    filterLast,
    thickness: clamp(1 - thickness * thickness, 0, 0.99),
    radiusCm: values.ambientOcclusionHorizonRadius * CM,
    angles: values.ambientOcclusionHorizonAngles,
    pauseJitter: values.ambientOcclusionHorizonPauseJitter,
    downscale: values.ambientOcclusionHorizonDownsample ? 2 : 1,
    temporal: values.ambientOcclusionHorizonTemporal,
    spatial: values.ambientOcclusionHorizonSpatial,
    blend: values.ambientOcclusionHorizonBlend,
  }
}
