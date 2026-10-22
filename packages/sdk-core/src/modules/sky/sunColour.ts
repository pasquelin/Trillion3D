import { rowTimes, XYZ_TO_SRGB } from '../../../../math/src/color/color.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import {
  ANY_NUMBER as ANY,
  flagSetting as flag,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from '../../contracts/settingRules.ts'

/**
 * The colour of a light's temperature: a light with `useTemperature` on has its colour multiplied
 * by the colour of a black body at `temperatureKelvin`, in the working space (linear sRGB, Rec. 709
 * primaries, D65 white). The sky module's sun part (`./sunPart.ts`) turns it on at 6500 K.
 */

/** The temperature's settings: off, 6500 K (the D65 white). The kelvin is clamped where the colour
 *  is made (`temperatureFactor`), not refused. */
export const SUN_TEMPERATURE_RULES = /* @__PURE__ */ (() =>
  rulesOf([flag('useTemperature', false), number('temperatureKelvin', 6500, ANY)] as const))()

/** What a host writes for the temperature. */
export type SunTemperatureOptions = SettingOptions<typeof SUN_TEMPERATURE_RULES>
/** The temperature's settings as resolved. */
export type SunTemperatureSettings = SettingValues<typeof SUN_TEMPERATURE_RULES>

/** The temperatures the black body's curve is fitted for, in kelvin. */
const LEAST_KELVIN = 1000
const MOST_KELVIN = 15000

type Vec3 = readonly [number, number, number]

/**
 * The linear RGB factor of a black body at `kelvin`, clamped to 1000..15000 K: the point on an
 * approximation of the Planckian locus in the CIE 1960 UCS, to (x, y), to XYZ at luminance 1, to
 * linear sRGB, each channel kept at zero or more. Not normalised beyond the luminance of the XYZ.
 */
export function temperatureFactor(kelvin: number): Vec3 {
  const t = clamp(kelvin, LEAST_KELVIN, MOST_KELVIN)
  const t2 = t * t
  const u =
    (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t2) /
    (1 + 8.42420235e-4 * t + 7.08145163e-7 * t2)
  const v =
    (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t2) /
    (1 - 2.89741816e-5 * t + 1.61456053e-7 * t2)
  const d = 2 * u - 8 * v + 4
  const x = (3 * u) / d
  const y = (2 * v) / d
  const z = 1 - x - y
  const [r, g, b] = rowTimes([x / y, 1, z / y], XYZ_TO_SRGB)
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)]
}

/** A light's colour, with its temperature's factor multiplied in when `useTemperature` is on
 *  (the colour as it is otherwise). The intensity multiplies the result, not the factor. */
export function temperatureColour(
  colour: Vec3,
  { useTemperature, temperatureKelvin }: SunTemperatureSettings,
): Vec3 {
  if (!useTemperature) return colour
  const f = temperatureFactor(temperatureKelvin)
  return [colour[0] * f[0], colour[1] * f[1], colour[2] * f[2]]
}
