import { chromaticityOfUv, planckianUv } from '../../../math/src/color/planck.ts'
import { multiply3 } from '../../../math/src/matrix/matrix3.ts'
import { applyMatrix3Vector3, length2 } from '../../../math/src/vector/vector.ts'
import { FILM, fromRows } from './filmCurveConstants.ts'

/**
 * The white balance of the colour grade: the matrix that takes the light of the working gamut
 * (sRGB's) from the white a temperature and a tint name to the display's white, D65 — or, read the
 * other way, from the display's white to that one. The white of a temperature is the daylight locus
 * from 4000 kelvins up and the black body's locus under it, moved along its isotherm by the tint;
 * the two whites are adapted by a von Kries scaling of the cone responses (Bradford's), carried
 * through XYZ. It is made on the processor, once a change, in double precision: the shader only
 * multiplies by it (`toneBakeWgsl.ts`).
 */

/** A chromaticity: CIE 1931 `x` and `y`. */
type Chromaticity = readonly [number, number]
type V3 = [number, number, number]

/** The display's white, D65. */
const D65_WHITE: Chromaticity = [0.3127, 0.329]
/** The temperature that, with a tint of 0, takes the light as it is. */
const NEUTRAL_TEMPERATURE = 6500
/** The tint at which the temperature's own white is kept. */
const NEUTRAL_TINT = 0
/** The distance from the neutral temperature or tint under which the balance is the identity: the
 *  two are not told from it. */
const NEUTRAL_EPSILON = 1e-8

/** Bradford's cone response and its inverse, as the colour-science tables print them. */
const CONE_RESPONSE = fromRows([
  0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296,
])
const CONE_RESPONSE_INVERSE = fromRows([
  0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428,
  0.9684867,
])

/** The chromaticity of the daylight locus at `temperature`, accurate from 4000 to 25000 kelvins;
 *  the temperature is first corrected for the revision of Planck's law, which makes 6500 D65. */
function daylightChromaticity(temperature: number): Chromaticity {
  const t = temperature * (1.4388 / 1.438)
  const inverse = 1 / t
  const x =
    t <= 7000
      ? 0.244063 + (0.09911e3 + (2.9678e6 - 4.607e9 * inverse) * inverse) * inverse
      : 0.23704 + (0.24748e3 + (1.9018e6 - 2.0064e9 * inverse) * inverse) * inverse
  return [x, -3 * x * x + 2.87 * x - 0.275]
}

/** The black body's chromaticity at `temperature`. */
const planckianChromaticity = (temperature: number) => chromaticityOfUv(...planckianUv(temperature))

/** The black body's chromaticity at `temperature`, moved along its isotherm — the line of the
 *  colours of one correlated temperature — by `tint`: the isotherm's direction is the normalised
 *  slope of the locus, and a tint of 1 moves 0.05 in (u, v). */
function planckianIsothermal(t: number, tint: number): Chromaticity {
  const [u, v] = planckianUv(t)
  const ud =
    (-1.13758118e9 - 1.91615621e6 * t - 1.53177 * t * t) / (1.41213984e6 + 1189.62 * t + t * t) ** 2
  const vd =
    (1.97471536e9 - 705674 * t - 308.607 * t * t) / (6.19363586e6 - 179.456 * t + t * t) ** 2
  const length = length2(ud, vd)
  return chromaticityOfUv(u + (vd / length) * tint * 0.05, v + (-ud / length) * tint * 0.05)
}

/** The tristimulus values of the chromaticity `xy` at a luminance of 1. */
const toXyz = ([x, y]: Chromaticity): V3 => [
  x / Math.max(y, 1e-10),
  1,
  (1 - x - y) / Math.max(y, 1e-10),
]

/** The matrix, in XYZ, that adapts the white `source` to the white `destination`: the cone
 *  responses of the two scale one another. */
function chromaticAdaptation(source: Chromaticity, destination: Chromaticity) {
  const cones = (white: Chromaticity) => {
    const [x, y, z] = toXyz(white)
    return applyMatrix3Vector3<V3>([0, 0, 0], CONE_RESPONSE, x, y, z)
  }
  const from = cones(source),
    to = cones(destination)
  const scale = [to[0] / from[0], 0, 0, 0, to[1] / from[1], 0, 0, 0, to[2] / from[2]]
  return multiply3(CONE_RESPONSE_INVERSE, multiply3(scale, CONE_RESPONSE))
}

/** Whether a temperature and a tint change the light: not at the neutral pair. */
export const balances = (temperature: number, tint: number) =>
  Math.abs(temperature - NEUTRAL_TEMPERATURE) > NEUTRAL_EPSILON ||
  Math.abs(tint - NEUTRAL_TINT) > NEUTRAL_EPSILON

/**
 * The white balance's matrix, nine numbers column after column (a `mat3x3f`'s order), for the
 * temperature `temperature` in kelvins and the tint `tint`. The white of the temperature is the
 * black body's under 4000 kelvins, the daylight's from there, moved by the tint; `asTemperature`
 * false takes it to the display's white (the white balance), true takes the display's white to it
 * (the colour temperature: the image turned toward that light).
 */
export function whiteBalanceMatrix(temperature: number, tint: number, asTemperature: boolean) {
  const planckian = planckianChromaticity(temperature)
  const base = temperature < 4000 ? planckian : daylightChromaticity(temperature)
  const isothermal = planckianIsothermal(temperature, tint)
  const white: Chromaticity = [
    base[0] + isothermal[0] - planckian[0],
    base[1] + isothermal[1] - planckian[1],
  ]
  const adaptation = asTemperature
    ? chromaticAdaptation(D65_WHITE, white)
    : chromaticAdaptation(white, D65_WHITE)
  const { xyzToSrgb, srgbToXyz } = FILM.numbers
  return multiply3(xyzToSrgb, multiply3(adaptation, srgbToXyz))
}
