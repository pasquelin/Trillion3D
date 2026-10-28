import {
  ANY_NUMBER,
  INT32_RANGE,
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE VIEW'S SETTINGS OF THE SCREEN-SPACE TRACES: the two methods that answer a surface's reflection and
 * its indirect diffuse light from the image alone — a ray marched through the depth pyramid, which reads the
 * last lit image where it meets a surface — and the settings of each. Run-time settings, as `./settingRules.ts`
 * says: no compiler job names them, no manifest carries them, each is read again at each image by
 * `packages/sdk-browser/src/lighting/screenSpaceTracing/`, and each default is the reference's. A quality
 * preset writes none of them.
 *
 * THE METHODS. `reflectionMethod` and `globalIlluminationMethod` name what answers the view's reflections
 * and its indirect diffuse light: `'scene'` (the default) the rays traced through the scene (the reflection
 * trace, the screen probes), `'screen'` the screen-space trace of this file, `'off'` nothing — a reflection
 * method of `'off'` leaves the surfaces the reflection captures and the sky light alone. The scene's method
 * answers where it is on; the screen-space one answers where the method names it and the scene's does not
 * (`resolveScreenSpaceMethod`): the reflections fall back to the screen from any method but `'off'`, the
 * indirect light only where the method is `'screen'`.
 *
 * THE REFLECTIONS (`'screen'`): `screenReflectionLevel` (3, from 0 to 4) caps the trace's quality, 0 turns it
 * off; `screenReflectionQuality` (50, from 0 to 100) is the view's own, and the trace takes the level it
 * reaches under both (`screenReflectionQualityOf`: very high from 80 and level 4, high from 60 and level 3,
 * medium from 40 and level 2, else low); `screenReflectionIntensity` (100, from 0 to 100) is the share of
 * the light brought back, below 1 the trace is skipped; `screenReflectionMaxRoughness` (0.6, from 0.01 to 1)
 * the roughness at which the reflection has faded out; `visualizeScreenReflections` (off) shows the
 * pixels that trace in a checker. Each ray reads the last lit image, or, with `screenReflectionHalfResColor`
 * (off), its half-resolution twin. `screenReflectionTemporal` (off) asks the temporal filter of the
 * reflections where the anti-aliasing is itself temporal (it is always on where it is not); the filter reads the current image through a
 * kernel of `screenReflectionFilterSize` (1) pixels, a Gaussian or, with `screenReflectionCatmullRom` (off), a Catmull-Rom.
 * `screenReflectionDenoiser` (off) replaces that temporal filter by the screen denoiser: the trace also writes how far its rays met a surface, a
 * spatial reconstruction along the reflection lobe (`screenReflectionDenoiserSamples`, 8 samples at most, from 1 to 56) then
 * `screenReflectionDenoiserPreConvolution` (1, from 0 to 4) wider passes, and the accumulation over time (`screenReflectionDenoiserTemporal`, on).
 * `screenReflectionStencil` (off) marks the pixels that trace in a stencil first and draws the trace over
 * them alone; `screenReflectionCompute` (off) runs the trace as a compute pass (the one the device has; the
 * reference's asynchronous one is the same pass).
 *
 * THE TILES (`screenReflectionTiles`, off): the pixels that trace are gathered by 8 by 8 tiles, and the trace
 * and its composition run over the tiles alone. A pixel traces under it where its roughness is at most
 * `screenReflectionTilesMaxRoughness` (−1: the view's maximum roughness above), its specular at least
 * `screenReflectionTilesMinSpecular` (0, from −0.001 to 1.001). `screenReflectionTilesShow` (off) tints the tiles.
 *
 * THE INDIRECT LIGHT (`'screen'`): `screenGiLevel` (4) is the quality, from 1 to 4 — 4, 8, 16 or 32 rays a
 * pixel —, below 1 the method is off, above 4 it is 4; the rays read the last lit image reduced to a chain
 * of five levels (`screenGiSkyDistance`: past this many metres, 100 000, a pixel of the last image is sky
 * and brings no light); `diffuseIndirectHalfRes` (on) traces at half the image's size. `screenGiDenoiser` (on) runs the screen denoiser over
 * the light and its occlusion — a spatial reconstruction of `screenGiDenoiserSamples` (8, from 1 to 56) samples, then, with `screenGiDenoiserTemporal`
 * (on), the accumulation over time —; off, the rays' mean is the light and nothing is occluded.
 */

/** The names of the methods a view's reflections and indirect light take. */
const SCREEN_SPACE_METHODS = ['off', 'scene', 'screen'] as const
/** One of the methods. */
export type ScreenSpaceMethod = (typeof SCREEN_SPACE_METHODS)[number]

/** The settings of the screen-space traces by field, each with the reference's default. */
export const SCREEN_SPACE_TRACING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('reflectionMethod', 'scene', SCREEN_SPACE_METHODS),
    choice('globalIlluminationMethod', 'scene', SCREEN_SPACE_METHODS),
    integer('screenReflectionLevel', 3, [0, 4]),
    number('screenReflectionQuality', 50, [0, 100]),
    number('screenReflectionIntensity', 100, [0, 100]),
    number('screenReflectionMaxRoughness', 0.6, [0.01, 1]),
    flag('visualizeScreenReflections', false),
    flag('screenReflectionHalfResColor', false),
    flag('screenReflectionTemporal', false),
    number('screenReflectionFilterSize', 1, [0.01, 100]),
    flag('screenReflectionCatmullRom', false),
    flag('screenReflectionDenoiser', false),
    integer('screenReflectionDenoiserSamples', 8, [1, 56]),
    integer('screenReflectionDenoiserPreConvolution', 1, [0, 4]),
    flag('screenReflectionDenoiserTemporal', true),
    flag('screenReflectionStencil', false),
    flag('screenReflectionCompute', false),
    flag('screenReflectionTiles', false),
    number('screenReflectionTilesMaxRoughness', -1, ANY_NUMBER),
    number('screenReflectionTilesMinSpecular', 0, [-0.001, 1.001]),
    flag('screenReflectionTilesShow', false),
    integer('screenGiLevel', 4, INT32_RANGE),
    number('screenGiSkyDistance', 100000, [0, ANY_NUMBER[1]]),
    flag('diffuseIndirectHalfRes', true),
    flag('screenGiDenoiser', true),
    integer('screenGiDenoiserSamples', 8, [1, 56]),
    flag('screenGiDenoiserTemporal', true),
  ] as const))()

/** The field of one setting of the screen-space traces. */
export type ScreenSpaceTracingField = keyof typeof SCREEN_SPACE_TRACING_RULES
/** The settings of the screen-space traces as a host writes them, by their fields: each its value, or nothing for its default. */
export type ScreenSpaceTracingOptions = SettingOptions<typeof SCREEN_SPACE_TRACING_RULES>
/** The settings of the screen-space traces, resolved. */
export type ScreenSpaceTracingValues = SettingValues<typeof SCREEN_SPACE_TRACING_RULES>

/** The levels of the screen reflections' trace, in the order of their quality: the checker that shows the pixels that trace,
 *  then low, medium, high and very high. */
const SCREEN_REFLECTION_QUALITIES = ['visualize', 'low', 'medium', 'high', 'veryHigh'] as const
export type ScreenReflectionQuality = (typeof SCREEN_REFLECTION_QUALITIES)[number]

/**
 * The level the screen reflections trace at, from the view's quality `quality` (0 to 100), the level cap `level` (0 to 4) and whether the
 * checker is asked: the checker when it is; very high from a quality of 80 and a cap of 4; high from 60 and 3; medium from 40 and 2; else low.
 */
export function screenReflectionQualityOf(
  quality: number,
  level: number,
  visualize: boolean,
): ScreenReflectionQuality {
  const cap = Math.min(Math.max(level, 0), SCREEN_REFLECTION_QUALITIES.length - 1)
  if (visualize) return 'visualize'
  if (quality >= 80 && cap >= 4) return 'veryHigh'
  if (quality >= 60 && cap >= 3) return 'high'
  if (quality >= 40 && cap >= 2) return 'medium'
  return 'low'
}

/**
 * What answers a view's reflections and its indirect light: `'scene'` where the scene's own method is on (`sceneOn`) and the method names it;
 * else the screen, where the reflections' method is not `'off'` — they fall back to the screen from the scene's method — and, for the indirect
 * light, only where the method is `'screen'`; else `'off'`. `screenOn` is whether the screen trace can run at all (`screenReflectionsOn`,
 * `screenIndirectOn`).
 */
export function resolveScreenSpaceMethod(
  method: ScreenSpaceMethod,
  sceneOn: boolean,
  screenOn: boolean,
  fallsBackToScreen: boolean,
): ScreenSpaceMethod {
  if (method === 'scene' && sceneOn) return 'scene'
  const asksScreen = method === 'screen' || (fallsBackToScreen && method !== 'off')
  return asksScreen && screenOn ? 'screen' : 'off'
}

/**
 * Whether the screen reflections run: the method is not `'off'`, the quality level is above 0, the intensity is at least 1 and the view
 * keeps a history (`hasHistory`: a view with no state has no pyramid of its own).
 */
export const screenReflectionsOn = (values: ScreenSpaceTracingValues, hasHistory: boolean) =>
  values.reflectionMethod !== 'off' &&
  hasHistory &&
  values.screenReflectionLevel > 0 &&
  values.screenReflectionIntensity >= 1

/** Whether the screen indirect light runs: the method is `'screen'`, the level is above 0 and the last lit image and depth are held. */
export const screenIndirectOn = (values: ScreenSpaceTracingValues, historyHeld: boolean) =>
  values.globalIlluminationMethod === 'screen' && values.screenGiLevel > 0 && historyHeld
