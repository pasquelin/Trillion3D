/**
 * The standard output transform's appearance model on the processor, in double precision, for the
 * tests: the oracle the shipped shader (`acesWgsl.ts`) is held to (`acesDisplay.test.ts`) and the
 * evaluator of the hue tables' generator (`acesTables.fixture.ts`). The engine keeps only the
 * transform's numbers and the viewing conditions (`acesCam.ts`, `acesHull.ts`, `acesDisplay.ts`).
 * A colour's lightness `J`, colourfulness `M` and hue `h` — `JMh` — come from its XYZ tristimulus
 * values under a viewing condition and go back; the transform's two compressions and the whole
 * transform are `acesGamutModel.fixture.ts`.
 */
import { DEG2RAD, RAD2DEG } from '../../../../math/src/constants.ts'
import { length2 } from '../../../../math/src/vector/vector.ts'
import { times3 } from '../triple.ts'
import {
  CONES_TO_XYZ,
  MODEL,
  XYZ_TO_CONES,
  type V3,
  type toneScaleOf,
  type viewingFor,
} from './acesCam.ts'

type Viewing = ReturnType<typeof viewingFor>

/** The luminance of the reference white the transform's lights are scaled to: 1 is 100 nits. */
export const REFERENCE_NITS = 100

/** `x` as an angle in degrees in [0, 360). */
export const wrapHue = (x: number) => {
  const wrapped = x % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}
/** A power that has no value for a negative base and a fractional exponent reads 0 there. */
const safePower = (base: number, exponent: number) =>
  base < 0 && exponent !== Math.floor(exponent) ? 0 : base ** exponent

/** The response's compression of one cone response, keeping its sign, and the compression undone. */
const compress = (c: number) => {
  const v = (MODEL.level * Math.abs(c) * 0.01) ** MODEL.power
  return (Math.sign(c) * MODEL.ceiling * v) / (MODEL.offset + v)
}
const expand = (c: number) => {
  const a = Math.abs(c)
  const power = safePower((MODEL.offset * a) / (MODEL.ceiling - a), 1 / MODEL.power)
  return ((Math.sign(c) * 100) / MODEL.level) * power
}

/** The lightness, colourfulness and hue of `xyz` (in nits) under the condition `view`. */
export function xyzToJmh(xyz: readonly number[], view: Viewing): V3 {
  const cones = times3(XYZ_TO_CONES, xyz)
  const [r, g, b] = cones.map((c, i) => compress(view.d[i] * c))
  const a = r - (12 * g) / 11 + b / 11
  const o = (r + g - 2 * b) / 9
  const hue = a === 0 && o === 0 ? 0 : RAD2DEG * Math.atan2(o, a)
  const lightness =
    100 * ((MODEL.redWeight * r + g + MODEL.blueWeight * b) / view.aw) ** (MODEL.surroundJ * view.z)
  const colourfulness = lightness === 0 ? 0 : 43 * MODEL.surroundM * length2(a, o)
  return [lightness, colourfulness, wrapHue(hue)]
}

/** The tristimulus values, in nits, of the lightness, colourfulness and hue `jmh` under the
 *  condition `view`. */
export function jmhToXyz(jmh: readonly number[], view: Viewing): V3 {
  const [lightness, colourfulness, hue] = jmh
  const response = view.aw * safePower(lightness / 100, 1 / (MODEL.surroundJ * view.z))
  const gamma = colourfulness / (43 * MODEL.surroundM)
  const a = gamma * Math.cos(hue * DEG2RAD)
  const o = gamma * Math.sin(hue * DEG2RAD)
  const adapted = [
    (460 * response + 451 * a + 288 * o) / 1403,
    (460 * response - 891 * a - 261 * o) / 1403,
    (460 * response - 220 * a - 6300 * o) / 1403,
  ]
  return times3(
    CONES_TO_XYZ,
    adapted.map((c, i) => expand(c) / view.d[i]),
  )
}

/** The luminance, in nits, of a lightness: `yToJ` the other way, the model's, achromatic. */
export const jToY = (j: number) => {
  const a = MODEL.white * (Math.abs(j) / 100) ** (1 / (MODEL.surroundJ * MODEL.greyZ))
  return (
    ((Math.sign(j) * 100) / MODEL.level) *
    ((MODEL.offset * a) / (MODEL.ceiling - a)) ** (1 / MODEL.power)
  )
}

/** The luminance, in nits, the tone scale `p` gives the scene-referred light `x`. */
export function toneScale(x: number, p: ReturnType<typeof toneScaleOf>) {
  const f = p.m2 * (Math.max(0, x) / (x + p.s2)) ** p.g
  return Math.max(0, (f * f) / (f + p.t1)) * p.nr
}
