import { chromaticityOfUv, planckianUv } from '../../../../math/src/color/planck.ts'
import { rowTimes, XYZ_TO_SRGB } from '../../../../math/src/color/color.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

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
  const [x, y] = chromaticityOfUv(...planckianUv(t))
  const z = 1 - x - y
  const [r, g, b] = rowTimes([x / y, 1, z / y], XYZ_TO_SRGB)
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)]
}
