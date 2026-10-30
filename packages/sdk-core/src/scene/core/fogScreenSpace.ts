/**
 * THE FOG'S SCREEN-SPACE SCATTERING: the fog and part of the lit image blurred in the plane of the
 * screen, to stand for the light the fog scatters several times.
 *
 * Off by default: `screenSpaceScattering: true` turns it on with every field at its default, an
 * object turns it on with the fields it names. The fog is then drawn into textures of its own and
 * laid over the image by a last pass (`packages/sdk-browser/src/lighting/fog/separate*`); the run
 * settings `fogSeparateComposition`, `fogScreenSpaceScattering` and
 * `fogScreenSpaceScatteringMaxLuminance` (`../../contracts/volumetricFogOptions.ts`) say whether
 * that happens and how bright a texel may be when it is blurred.
 */
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { objectOf, rangedFields, type FogRange } from './fogChecks.ts'

/** The screen-space scattering of a height fog (`SceneHeightFog.screenSpaceScattering`). */
export interface SceneFogScreenSpaceScattering {
  /** The share of the lit image injected into the blur, from 0: 0 scatters the fog's light alone, 1
   *  the fog's and the image's, above 1 more of the image where the fog is thin (never more than the
   *  image holds). 1 by default. */
  sceneColorScatteringAmountScale?: number
  /** The power applied to the amount of the image scattered once the scale has set it, from 0: below 1
   *  scatters more where the fog is thin. 1 by default. */
  sceneColorScatteringAmountPower?: number
  /** The scale of the spread: it scales the level of the blurred texture a pixel reads, from 0; higher
   *  makes the scene and the thick fog fuzzier, too high leaves halos at depth edges. 0.1 by default. */
  spreadScale?: number
  /** How much of the blurrier levels is injected back into the sharper ones when the blurred texture
   *  is built, in [0, 1]: 1 makes the scattering one average colour. 0.5 by default. */
  blurControl?: number
}

/** A screen-space scattering with every field set. */
export type ResolvedFogScreenSpaceScattering = Required<SceneFogScreenSpaceScattering>

/** The defaults of the screen-space scattering. */
export const FOG_SCREEN_SPACE_DEFAULTS: ResolvedFogScreenSpaceScattering = {
  sceneColorScatteringAmountScale: 1,
  sceneColorScatteringAmountPower: 1,
  spreadScale: 0.1,
  blurControl: 0.5,
}

/** The scattering an option is, every field set over the defaults, held to the range of each: none
 *  where the option is off (`true` the defaults, `false` or absent off). */
export function resolveFogScreenSpaceScattering(
  option: boolean | SceneFogScreenSpaceScattering | undefined,
): ResolvedFogScreenSpaceScattering | undefined {
  if (!option) return undefined
  const d = FOG_SCREEN_SPACE_DEFAULTS
  const v = option === true ? {} : option
  return {
    sceneColorScatteringAmountScale: Math.max(
      v.sceneColorScatteringAmountScale ?? d.sceneColorScatteringAmountScale,
      0,
    ),
    sceneColorScatteringAmountPower: Math.max(
      v.sceneColorScatteringAmountPower ?? d.sceneColorScatteringAmountPower,
      0,
    ),
    spreadScale: Math.max(v.spreadScale ?? d.spreadScale, 0),
    blurControl: clamp(v.blurControl ?? d.blurControl, 0, 1),
  }
}

/** The range of each number of the scattering. */
const SCREEN_SPACE_RANGES = {
  sceneColorScatteringAmountScale: [0, Infinity],
  sceneColorScatteringAmountPower: [0, Infinity],
  spreadScale: [0, Infinity],
  blurControl: [0, 1],
} as const satisfies Record<string, FogRange>

/** A screen-space scattering option checked: `true`, `false`, or an object whose numbers lie in their
 *  ranges; a copy. */
export function validateFogScreenSpaceScattering(
  option: unknown,
  fog: unknown,
): boolean | SceneFogScreenSpaceScattering {
  if (typeof option === 'boolean') return option
  const v = objectOf<SceneFogScreenSpaceScattering>(option, 'screenSpaceScattering', fog)
  const out: SceneFogScreenSpaceScattering = {}
  rangedFields(v, out, SCREEN_SPACE_RANGES, fog, 'screenSpaceScattering.')
  return out
}
