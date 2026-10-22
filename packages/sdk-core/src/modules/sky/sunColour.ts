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
 * primaries, D65 white). The sky module's base sun turns it on at 6500 K.
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
type Mat3 = readonly [Vec3, Vec3, Vec3]

/** The sRGB primaries' and white's chromaticities (x, y). */
const RED = [0.64, 0.33] as const
const GREEN = [0.3, 0.6] as const
const BLUE = [0.15, 0.06] as const
const WHITE = [0.3127, 0.329] as const

const inverse = (m: Mat3): Mat3 => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}

/** A row vector times a matrix. */
const times = (v: Vec3, m: Mat3): Vec3 => [
  v[0] * m[0][0] + v[1] * m[1][0] + v[2] * m[2][0],
  v[0] * m[0][1] + v[1] * m[1][1] + v[2] * m[2][1],
  v[0] * m[0][2] + v[1] * m[1][2] + v[2] * m[2][2],
]

/** The XYZ to linear sRGB matrix, made from the chromaticities: each primary's row (x, y, z) is
 *  scaled so that white (1, 1, 1) lands on the white point at luminance 1, then inverted. */
const XYZ_TO_RGB: Mat3 = /* @__PURE__ */ (() => {
  const row = ([x, y]: readonly [number, number]): Vec3 => [x, y, 1 - x - y]
  const primaries: Mat3 = [row(RED), row(GREEN), row(BLUE)]
  const [wx, wy] = WHITE
  const scale = times([wx / wy, 1, (1 - wx - wy) / wy], inverse(primaries))
  return inverse(primaries.map((r, i) => r.map((x) => x * scale[i]!)) as unknown as Mat3)
})()

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
  const [r, g, b] = times([x / y, 1, z / y], XYZ_TO_RGB)
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
