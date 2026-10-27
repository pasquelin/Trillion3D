import { refusal } from './nameMatch.ts'
import {
  nonNegativeSetting as nonNegative,
  contextReader,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'
import { isPow2 } from '../../../math/src/scalar/integers.ts'
import { resolveSkyLightCubemap, type SkyLightCubemap } from '../modules/sky/skyLightCubemap.ts'

/**
 * THE AMBIENT CUBEMAP, a light the image adds to every lit surface from a cube of the host's, in the
 * indirect light (a second source beside the environment's and the sky light's, weighed by the same sums, every lobe taking it): the surface's diffuse colour times the cube read along
 * its normal at the mip where the cube is convolved by the whole hemisphere, and its specular reflectance times the cube
 * read along its reflection at the mip its roughness picks. Run-time settings, as `./settingRules.ts` says; the quality
 * levels write none of them. Off by default: with no cube, or a cube whose colour is black, nothing is drawn and the lit programs hold no code for it.
 *
 * - `ambientCubemap`, the field that is no setting: the cube, as data (`SkyLightCubemap`, the form the sky light's
 *   specified cubemap has: `size` texels across a face, a power of two from 16 to 1024, and the six faces' linear colours), or none (`null`, the default);
 *   the engine makes its mip chain once and keeps it while the data is the same;
 * - `ambientCubemapTintRed`, `ambientCubemapTintGreen` and `ambientCubemapTintBlue` (1 each): the tint the cube's light is
 *   multiplied by, a linear colour written as its three channels as the film's tint is;
 * - `ambientCubemapIntensity` (1, from 0): the scale of the cube's light, which multiplies the tint.
 */
export const AMBIENT_CUBEMAP_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('ambientCubemapTintRed', 1),
    nonNegative('ambientCubemapTintGreen', 1),
    nonNegative('ambientCubemapTintBlue', 1),
    nonNegative('ambientCubemapIntensity', 1),
  ] as const))()

/** The least side of the cube, in texels: its mip chain (`../lighting/ambientCubemapMips.ts`) must reach past the four mips the hemisphere's convolution sits above the last. */
export const AMBIENT_CUBEMAP_MIN_SIZE = 16

/** The field of one ambient cubemap setting. */
export type AmbientCubemapField = keyof typeof AMBIENT_CUBEMAP_RULES

/** The ambient cubemap's settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type AmbientCubemapSettings = SettingOptions<typeof AMBIENT_CUBEMAP_RULES>

/** The ambient cubemap's settings as the engine reads them: every field set. */
export type AmbientCubemapValues = SettingValues<typeof AMBIENT_CUBEMAP_RULES>

/** The ambient cubemap as a host writes it: its settings, and the cube. */
export interface AmbientCubemapOptions extends AmbientCubemapSettings {
  /** The cube; none (the default) leaves the image without the ambient cubemap. */
  ambientCubemap?: SkyLightCubemap | null
}

/** The ambient cubemap as the engine reads it: every setting set, and the cube, none where the host gave none. */
export interface ResolvedAmbientCubemap extends AmbientCubemapValues {
  readonly ambientCubemap: SkyLightCubemap | undefined
}

/** The ambient cubemap setting `field` of a runtime's context (`contextReader`): its default where the context holds none. */
export const readAmbientCubemapSetting = /* @__PURE__ */ contextReader(AMBIENT_CUBEMAP_RULES)

/**
 * The ambient cubemap an option names: every field it leaves out is the default (`AMBIENT_CUBEMAP_RULES`, no cube).
 * @throws TypeError naming the field and what it takes when a setting is out of its range or the cube is not a cube of
 *   `size` texels a face (a power of two from 16 to 1024) and `6 · size² · 3` finite linear numbers of at least 0.
 */
export function resolveAmbientCubemap(options: AmbientCubemapOptions = {}): ResolvedAmbientCubemap {
  const { ambientCubemap, ...settings } = options
  return Object.freeze({
    ...resolveSettings(AMBIENT_CUBEMAP_RULES, settings),
    ambientCubemap: resolveCube(ambientCubemap),
  })
}

/** The cube an option names, none for none: a cube of the sky light's form (`resolveSkyLightCubemap`) whose side is a power of
 *  two of at least `AMBIENT_CUBEMAP_MIN_SIZE`, which the mip chain is built over. */
function resolveCube(value: SkyLightCubemap | null | undefined) {
  if (value === undefined || value === null) return undefined
  const refuse = refusal('ambientCubemap')
  const cube = resolveSkyLightCubemap(value, 'ambientCubemap', refuse)
  if (!isPow2(cube.size) || cube.size < AMBIENT_CUBEMAP_MIN_SIZE)
    refuse(`size must be a power of two of at least ${AMBIENT_CUBEMAP_MIN_SIZE}, got ${cube.size}`)
  return cube
}

/** The colour the cube's light is multiplied by: the tint times the intensity, per channel. */
export const ambientCubemapColour = (values: AmbientCubemapValues) =>
  [
    values.ambientCubemapTintRed * values.ambientCubemapIntensity,
    values.ambientCubemapTintGreen * values.ambientCubemapIntensity,
    values.ambientCubemapTintBlue * values.ambientCubemapIntensity,
  ] as const

/** The square a channel of the colour must reach for the cube to count: a colour whose three squares are all under it, 1e-5, is
 *  black, and the lit programs leave it out. */
const BLACK_SQUARE = 0.00001

/** Whether the image draws the ambient cubemap: there is a cube, and the colour it is multiplied by is not black. */
export const isAmbientCubemapActive = (ambient: ResolvedAmbientCubemap) => {
  if (!ambient.ambientCubemap) return false
  const colour = ambientCubemapColour(ambient)
  return colour.some((channel) => channel * channel >= BLACK_SQUARE)
}
