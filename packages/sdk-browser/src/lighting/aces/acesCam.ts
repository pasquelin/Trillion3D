/**
 * The colour appearance model of the standard output transform (`acesDisplay.ts`): the numbers of
 * the Hellwig–Fairchild model of 2022, without its Helmholtz–Kohlrausch term and at full
 * adaptation, that the shader repeats (`MODEL`), the viewing condition of a white — the scale of
 * each cone response that takes the white to equal ones and its achromatic response — and the
 * transform's tone scale (`toneScaleOf`) and lightness of a luminance (`yToJ`). The cone responses
 * are scaled so the white of the condition gives equal ones, compressed by a power-like curve, then
 * read as an achromatic response and two opponent axes. The fixed numbers of the viewing
 * condition — an adapting luminance of 100 and a background of 20 nits, a dim surround — are the
 * transform's; its own white is the condition's variable. The model's evaluation on the processor
 * is the tests' (`acesModel.fixture.ts`).
 */
import { fromRows } from '../filmCurveConstants.ts'
import { times3, type V3 } from '../triple.ts'

export type { V3 }

/** XYZ to the sharpened cone responses the model works in (rows), and back. */
export const XYZ_TO_CONES = fromRows([
  0.3640744835, 0.5947008156, 0.04110127349, -0.2222450987, 1.0738554823, 0.1479453361,
  -0.002067619, 0.0488260453, 0.95038755696,
])
export const CONES_TO_XYZ = fromRows([
  2.0512756811, -1.1400313439, 0.0887556628, 0.4269389763, 0.7005835277, -0.127522504,
  -0.0174712779, -0.0384725929, 1.0589468739,
])

/** The viewing condition's adapting and background luminances, in nits. */
const ADAPTING = 100
const BACKGROUND = 20
/** The weights of the red and the blue response in the achromatic response (the green's is 1). */
const RED_WEIGHT = 2
const BLUE_WEIGHT = 0.05
/** The surround's exponents for lightness and for colourfulness. */
const SURROUND_J = 0.59
const SURROUND_M = 0.9
/** The compression's exponent, and the offset and the ceiling of its curve. */
const RESPONSE_POWER = 0.42
const RESPONSE_OFFSET = 27.13
const RESPONSE_CEILING = 400
/** How the adapting luminance scales a response: the model's luminance-level factor. */
const LEVEL = (() => {
  const k4 = (1 / (5 * ADAPTING + 1)) ** 4
  return 0.2 * k4 * 5 * ADAPTING + 0.1 * (1 - k4) ** 2 * (5 * ADAPTING) ** (1 / 3)
})()

/** The luminance condition of the lightness–luminance pair: a white of luminance 100. */
const GREY_Z = 1.48 + Math.sqrt(BACKGROUND / 100)
const WHITE_RESPONSE = (() => {
  const v = LEVEL ** RESPONSE_POWER
  return (RESPONSE_CEILING * v) / (RESPONSE_OFFSET + v)
})()

/** The model's numbers, for the shader that repeats it (`acesWgsl.ts`): the luminance-level factor
 *  `level`, the weights of the red and the blue response, the surround's two exponents, the
 *  lightness exponent `greyZ` and the achromatic response `white` of a white of luminance 100. */
export const MODEL = {
  level: LEVEL,
  redWeight: RED_WEIGHT,
  blueWeight: BLUE_WEIGHT,
  surroundJ: SURROUND_J,
  surroundM: SURROUND_M,
  power: RESPONSE_POWER,
  offset: RESPONSE_OFFSET,
  ceiling: RESPONSE_CEILING,
  greyZ: GREY_Z,
  white: WHITE_RESPONSE,
}

/** The response's compression of one cone response, keeping its sign. */
const compress = (c: number) => {
  const v = (LEVEL * Math.abs(c) * 0.01) ** RESPONSE_POWER
  return (Math.sign(c) * RESPONSE_CEILING * v) / (RESPONSE_OFFSET + v)
}
/** What a viewing condition holds besides the fixed numbers: the scale `d` of each cone response
 *  that takes the white to equal ones, the achromatic response `aw` of the white and the exponent
 *  `z` of lightness. */
type Viewing = { d: V3; aw: number; z: number }

/** The viewing condition whose white has the tristimulus values `white`, the luminance of which
 *  is the condition's. */
export function viewingFor(white: readonly number[]): Viewing {
  const cones = times3(XYZ_TO_CONES, white)
  const d = cones.map((c) => white[1] / c) as V3
  const aw =
    RED_WEIGHT * compress(d[0] * cones[0]) +
    compress(d[1] * cones[1]) +
    BLUE_WEIGHT * compress(d[2] * cones[2])
  return { d, aw, z: 1.48 + Math.sqrt(BACKGROUND / white[1]) }
}

/** The lightness of a luminance `y` in nits: the model's, achromatic. */
export const yToJ = (y: number) => {
  const v = (LEVEL * Math.abs(y) * 0.01) ** RESPONSE_POWER
  const response = (RESPONSE_CEILING * v) / (RESPONSE_OFFSET + v)
  return Math.sign(y) * 100 * (response / WHITE_RESPONSE) ** (SURROUND_J * GREY_Z)
}

/**
 * The tone scale for a display of peak luminance `peak` (nits): a Michaelis–Menten curve of the
 * scene-referred light `x` — 1 is the reference white — with a flare toe, fitted so that 18 %
 * grey lands on the display's grey and the light that hits the roof (`hit`) lands on its peak.
 * `n` is the peak, `nr` the reference white, `g` the contrast, `t1` the toe, `ct` the grey's
 * luminance as a share of the reference, `s2` and `m2` the curve's own scale and gain.
 */
export function toneScaleOf(peak: number) {
  const [nr, g, grey, greyNits, greyShift, t1] = [100, 1.15, 0.18, 10.013, 0.14, 0.04]
  const hit = 128 + (896 - 128) * (Math.log(peak / nr) / Math.log(10000 / 100))
  const m0 = peak / nr
  const m1 = 0.5 * (m0 + Math.sqrt(m0 * (m0 + 4 * t1)))
  const u = (hit / m1 / (hit / m1 + 1)) ** g
  const m = m1 / u
  const stops = Math.log(peak / 100) / Math.log(2)
  const ct = (greyNits / nr) * (1 + stops * greyShift)
  const gip = 0.5 * (ct + Math.sqrt(ct * (ct + 4 * t1)))
  const w2 = grey / (-(m1 * (gip / m) ** (1 / g)) / ((gip / m) ** (1 / g) - 1))
  const s2 = w2 * m1
  const u2 = (hit / m1 / (hit / m1 + w2)) ** g
  return { n: peak, nr, g, t1, ct, s2, m2: m1 / u2 }
}
