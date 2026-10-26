/**
 * The standard output transform's two compressions and the whole transform on the processor, in
 * double precision, for the tests (`acesModel.fixture.ts` is the appearance model they run on): the
 * colourfulness is compressed with the lightness the tone scale gave the colour, and a colour that
 * still lies past the display's gamut is pulled onto it along a line of constant hue
 * (`mapGamut`). The gamut's edge is the cone of the display's primaries in `JMh`: its cusp and the
 * curvature of its upper face read from tables a hue indexes (`HueTables`), the reach of the
 * grading gamut bounding how far a colour is pulled from.
 */
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { clamp, mix } from '../../../../math/src/scalar/reals.ts'
import { length2 } from '../../../../math/src/vector/vector.ts'
import { FILM } from '../filmCurveConstants.ts'
import { times3 } from '../triple.ts'
import { yToJ, type V3 } from './acesCam.ts'
import { DISPLAY_VIEW, LIGHT_VIEW, TRANSFORM } from './acesDisplay.ts'
import type { HueTables, transformOf } from './acesHull.ts'
import {
  jmhToXyz,
  jToY,
  REFERENCE_NITS,
  toneScale,
  wrapHue,
  xyzToJmh,
} from './acesModel.fixture.ts'
import { SDR_TABLES } from './acesTables.ts'

type Transform = ReturnType<typeof transformOf>

/** The largest light, in the grading gamut's units, the transform reads: the clamp that takes a
 *  light to the half-float range with three stops to spare. */
const LARGEST = 8 * 128

/** The whole degree a hue falls at, in a table of 360, and the next one round. */
const slot = (h: number) => Math.trunc(wrapHue(h))

/** The grading gamut's reach at the hue `h`, between its two whole degrees. The table's step is one
 *  degree, so the weight of the upper entry is the distance past the lower one — the wrap from the
 *  last degree to the first included: the value is continuous all round the circle. (The reference
 *  divides by `high − low`, which is −359 at the wrap: its weight there stays near 0 and the value
 *  jumps from the last entry to the first when the hue reaches 360.) */
export function reachAt(h: number, reach: readonly number[]) {
  const hue = wrapHue(h),
    low = Math.trunc(hue)
  return mix(reach[low], reach[(low + 1) % 360], hue - low)
}

/** The cusp of the display gamut at the hue `h`, as its lightness and colourfulness, by a search of
 *  the sorted table for the two entries the hue lies between. */
export function cuspAt(h: number, cusp: readonly V3[]): [number, number] {
  let low = 0,
    high = 360 + 1,
    at = slot(h) + 1
  while (low + 1 < high) {
    if (h > cusp[at][2]) low = at
    else high = at
    at = (low + high) >> 1
  }
  // `high` starts at 361 and only takes an index `at` that is 1 or more (the first guess, or a middle past `low`).
  const [lo, hi] = [cusp[high - 1], cusp[high]]
  const t = (h - lo[2]) / (hi[2] - lo[2])
  return [mix(lo[0], hi[0], t), mix(lo[1], hi[1], t)]
}

/** The curvature of the upper face of the display gamut at the hue `h`. */
function upperGammaAt(h: number, gamma: readonly number[]) {
  const low = slot(h) + 1
  return mix(gamma[low], gamma[(low + 1) % gamma.length], wrapHue(h) - (low - 1))
}

/** A toe on `x` between 0 and `limit`: `k1` sets its size, `k2` its shape; past the limit, `x`. */
function toe(x: number, limit: number, k1: number, k2: number) {
  if (x > limit) return x
  const shape = Math.max(k2, 0.001),
    size = length2(k1, shape),
    scale = (limit + size) / (limit + shape)
  const b = scale * x - size
  return 0.5 * (b + Math.sqrt(b * b + 4 * shape * scale * x))
}

/** The scale of the colourfulness at the hue `h`: a Fourier series of the cusp's colourfulness. */
function normAt(h: number, scale: number) {
  const [a, b] = [Math.cos(h * DEG2RAD), Math.sin(h * DEG2RAD)]
  const [cos2, sin2] = [a * a - b * b, 2 * a * b]
  const [cos3, sin3] = [4 * a * a * a - 3 * a, 3 * b - 4 * b * b * b]
  return (
    scale *
    (11.34072 * a +
      16.46899 * cos2 +
      7.8838 * cos3 +
      14.66441 * b -
      6.37224 * sin2 +
      9.19364 * sin3 +
      77.12896)
  )
}

/** The colourfulness of `jmh` after the tone scale moved its lightness from `origJ` to `jmh[0]`:
 *  rescaled with the lightness, normalised to the hue, expanded where it is small — the toe run
 *  backwards from the reach — then compressed toward the reach, and denormalised. */
function compressChroma(
  jmh: readonly number[],
  origJ: number,
  p: Transform,
  reach: readonly number[],
) {
  const [lightness, colourfulness, hue] = jmh
  if (colourfulness === 0) return colourfulness
  const nj = lightness / p.limitJ,
    snj = Math.max(0, 1 - nj),
    norm = normAt(hue, p.norm)
  const limit = (nj ** p.modelGamma * reachAt(hue, reach)) / norm
  let m = (colourfulness * (lightness / origJ) ** p.modelGamma) / norm
  m = limit - toe(limit - m, limit - 0.001, snj * p.sat, Math.sqrt(nj * nj + p.satThr))
  return toe(m, limit, nj * p.compr, snj) * norm
}

/** The colourfulness ratio `v` (1 at the gamut's edge) rolled off between the threshold `thr` and
 *  `lim`, the ratio of the reach to the edge: unchanged under the threshold. */
function rollOff(v: number, thr: number, lim: number) {
  if (v < thr || lim <= 1.0001) return v
  const s = ((lim - thr) * (1 - thr)) / (lim - 1)
  const nd = (v - thr) / s
  return thr + (s * nd) / (1 + nd)
}

/** How much the projection lines steepen with the lightness above the cusp. */
export function focusGain(j: number, cuspJ: number, limitJ: number) {
  const thr = mix(cuspJ, limitJ, 0.3)
  if (j <= thr) return 1
  return Math.log10((limitJ - thr) / Math.max(0.0001, limitJ - j)) ** (1 / 0.55) + 1
}

/** The lightness at which the projection line through `(j, m)` from the focus `focusJ` meets the
 *  achromatic axis, the line's slope being `slopeGain` over the focus. */
function axisCrossing(j: number, m: number, focusJ: number, maxJ: number, slopeGain: number) {
  const a = m / (focusJ * slopeGain)
  const below = j < focusJ
  const b = below ? 1 - m / slopeGain : -(1 + m / slopeGain + (maxJ * m) / (focusJ * slopeGain))
  const c = below ? -j : (maxJ * m) / slopeGain + j
  const root = Math.sqrt(b * b - 4 * a * c)
  return (2 * c) / (below ? -b - root : -b + root)
}

/** The slope of the projection line that meets the axis at `cross`. */
const lineSlope = (cross: number, focusJ: number, maxJ: number, slopeGain: number) =>
  ((cross < focusJ ? cross : maxJ - cross) * (cross - focusJ)) / (focusJ * slopeGain)

/** The smooth minimum of `a` and `b`, over a width `s`. */
const smoothMin = (a: number, b: number, s: number) => {
  const h = Math.max(s - Math.abs(a - b), 0) / s
  return Math.min(a, b) - (h * h * h * s) / 6
}

/**
 * Where the projection line through `source` meets the display gamut's edge: its lightness and
 * colourfulness there, and the lightness at which the line meets the axis. The edge is the
 * smooth minimum of the lower face — a curve of exponent `gammaBottom` from the origin to the
 * cusp — and the upper face — a curve of exponent `gammaTop` from the cusp to the peak —, the cusp
 * pushed out a little where the minimum is smoothed.
 */
export function gamutEdge(
  source: readonly number[],
  cusp: readonly number[],
  focusJ: number,
  maxJ: number,
  slopeGain: number,
  gammaTop: number,
  gammaBottom: number,
): V3 {
  const smooth = 0.12
  const [cuspJ, cuspM] = [cusp[0], cusp[1] * (1 + 0.27 * smooth)]
  const cross = axisCrossing(source[0], source[1], focusJ, maxJ, slopeGain)
  const cuspCross = axisCrossing(cuspJ, cuspM, focusJ, maxJ, slopeGain)
  const slope = lineSlope(cross, focusJ, maxJ, slopeGain)
  const lower = (cuspCross * (cross / cuspCross) ** (1 / gammaBottom)) / (cuspJ / cuspM - slope)
  const upper =
    (cuspM * (maxJ - cuspCross) * ((maxJ - cross) / (maxJ - cuspCross)) ** (1 / gammaTop)) /
    (slope * cuspM + maxJ - cuspJ)
  const m = cuspM * smoothMin(lower / cuspM, upper / cuspM, smooth)
  return [cross + slope * m, m, cross]
}

/** The colourfulness of the grading gamut's edge along the projection line through `(j, m)`. */
function reachEdge(
  j: number,
  m: number,
  h: number,
  p: Transform,
  cuspJ: number,
  focusJ: number,
  reach: readonly number[],
) {
  const reachM = reachAt(h, reach)
  const slopeGain = p.limitJ * p.focus * focusGain(j, cuspJ, p.limitJ)
  const cross = axisCrossing(j, m, focusJ, p.limitJ, slopeGain)
  const slope = lineSlope(cross, focusJ, p.limitJ, slopeGain)
  return (p.limitJ * (cross / p.limitJ) ** p.modelGamma * reachM) / (p.limitJ - slope * reachM)
}

/** `jmh` pulled into the display gamut along its projection line: the part of its colourfulness
 *  between the edge and the grading gamut's reach is rolled off onto the edge. Under a
 *  colourfulness of 0.0001, or over the peak lightness, the colour is taken to the axis. */
function mapGamut(jmh: readonly number[], p: Transform, tables: HueTables): V3 {
  const [j, m, h] = jmh
  if (m < 0.0001 || j > p.limitJ) return [j, 0, h]
  const cusp = cuspAt(h, tables.cusp)
  const focusJ = mix(cusp[0], p.midJ, Math.min(1, 1.3 - cusp[0] / p.limitJ))
  const slopeGain = p.limitJ * p.focus * focusGain(j, cusp[0], p.limitJ)
  const edge = gamutEdge(
    jmh,
    cusp,
    focusJ,
    p.limitJ,
    slopeGain,
    upperGammaAt(h, tables.gamma),
    p.lowerGamma,
  )
  const reach = reachEdge(edge[0], edge[1], h, p, cusp[0], focusJ, tables.reach)
  const difference = Math.max(1.0001, reach / edge[1])
  const v = rollOff(m / edge[1], Math.max(0.75, 1 / difference), difference)
  return [edge[2] + v * (edge[0] - edge[2]), v * edge[1], h]
}

/** The linear sRGB colour in [0, 1] the display shows for the grading-gamut light `light` times
 *  `multiplier`: the light taken to the model's lightness, colourfulness and hue, its lightness put
 *  through the tone scale, its colourfulness compressed with it and the colour pulled into the
 *  display's gamut, then taken back to the display's primaries and cut to [0, 1]. The display's
 *  transfer is left to the caller. */
export function acesDisplay(light: readonly number[], multiplier: number): V3 {
  const xyz = times3(
    FILM.numbers.ap1ToXyz,
    light.map((c) => clamp(c * multiplier, 0, LARGEST)),
  )
  const jmh = xyzToJmh(
    xyz.map((c) => c * REFERENCE_NITS),
    LIGHT_VIEW,
  )
  const lightness = yToJ(toneScale(jToY(jmh[0]) / REFERENCE_NITS, TRANSFORM.scale))
  const tone: V3 = [lightness, jmh[1], jmh[2]]
  tone[1] = compressChroma(tone, jmh[0], TRANSFORM, SDR_TABLES.reach)
  const inside = mapGamut(tone, TRANSFORM, SDR_TABLES)
  const shown = times3(FILM.numbers.xyzToSrgb, jmhToXyz(inside, DISPLAY_VIEW)).map((c) =>
    clamp(c / REFERENCE_NITS, 0, 1),
  )
  return shown as V3
}
