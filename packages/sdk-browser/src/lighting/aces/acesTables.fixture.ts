// The hue tables of the standard output transform (`acesHull.ts`) made from the display's gamut:
// what `acesTables.ts` holds, written once as numbers, is held to what this makes. The reach
// table searches, for each hue, the colourfulness at which the grading gamut's primaries go
// negative; the cusp table samples the display gamut's brightest saturated colour at each hue and
// sorts the samples by their hue; the gamma table searches, for each hue, the smallest curvature
// of the gamut's upper face at which an approximation of the edge lies outside the display's
// gamut at three lightnesses above the cusp.
import { inverse3 } from '../../../../math/src/matrix/matrix3.ts'
import { mix } from '../../../../math/src/scalar/reals.ts'
import { FILM } from '../filmCurveConstants.ts'
import { times3 } from '../triple.ts'
import { viewingFor, type V3 } from './acesCam.ts'
import { transformOf, type HueTables } from './acesHull.ts'
import { cuspAt, focusGain, gamutEdge } from './acesGamutModel.fixture.ts'
import { jmhToXyz, REFERENCE_NITS, xyzToJmh } from './acesModel.fixture.ts'

const HUES = 360
/** The extra entries that wrap a table's hues, and the index of the smallest hue. */
const WRAPPED = 362

/** The RGB of a hue at full saturation and value (`h` in [0, 1)). */
function hueRgb(h: number): V3 {
  const c = 1,
    x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  if (h < 1 / 6) return [c, x, 0]
  if (h < 2 / 6) return [x, c, 0]
  if (h < 3 / 6) return [0, c, x]
  if (h < 4 / 6) return [0, x, c]
  if (h < 5 / 6) return [x, 0, c]
  return [c, 0, x]
}

/** The reach of the grading gamut at each whole degree, for a display of peak luminance `peak`:
 *  the colourfulness, at the peak's lightness, where a primary of the gamut turns negative. */
function reachTable(peak: number): number[] {
  const { numbers } = FILM
  const view = viewingFor(times3(numbers.ap1ToXyz, [100, 100, 100]))
  const toAp1 = inverse3(numbers.ap1ToXyz)
  const limitJ = transformOf(peak).limitJ
  const outside = (m: number, hue: number) =>
    times3(toAp1, jmhToXyz([limitJ, m, hue], view)).some((c) => c < 0)
  return Array.from({ length: HUES }, (_, hue) => {
    let low = 0,
      high = 50
    while (!outside(high, hue) && high < 1300) [low, high] = [high, high + 50]
    while (high - low > 1e-2) {
      const sample = (high + low) / 2
      if (outside(sample, hue)) high = sample
      else low = sample
    }
    return high
  })
}

/** The cusp of the sRGB gamut at each whole degree, sorted by hue from the smallest, one entry
 *  wrapped at each end (362), for a display of peak luminance `peak`. */
function cuspTable(peak: number): V3[] {
  const { numbers } = FILM
  const view = viewingFor(times3(numbers.srgbToXyz, [100, 100, 100]))
  const unsorted = Array.from({ length: HUES }, (_, i) => {
    const rgb = hueRgb(i / HUES).map((c) => (c * peak) / REFERENCE_NITS)
    return xyzToJmh(
      times3(numbers.srgbToXyz, rgb).map((c) => c * REFERENCE_NITS),
      view,
    )
  })
  let first = 0
  unsorted.forEach((jmh, i) => {
    if (jmh[2] < unsorted[first][2]) first = i
  })
  const table: V3[] = new Array(WRAPPED)
  for (let i = 0; i < HUES; i++) table[i + 1] = unsorted[(first + i) % HUES]
  table[0] = [table[HUES][0], table[HUES][1], table[HUES][2] - 360]
  table[HUES + 1] = [table[1][0], table[1][1], table[1][2] + 360]
  return table
}

/** The curvature of the sRGB gamut's upper face at each whole degree, wrapped at each end (362),
 *  for a display of peak luminance `peak`: the smallest at which an approximation of the edge lies
 *  outside the gamut at three lightnesses above the cusp. */
function gammaTable(cusp: readonly V3[], peak: number): number[] {
  const { numbers } = FILM
  const view = viewingFor(times3(numbers.srgbToXyz, [100, 100, 100]))
  const p = transformOf(peak)
  const outsideGamut = (jmh: V3) =>
    times3(numbers.xyzToSrgb, jmhToXyz(jmh, view)).some((c) => c > peak)
  const fits = (tests: V3[], cuspJm: readonly number[], gamma: number) => {
    const focusJ = mix(cuspJm[0], p.midJ, Math.min(1, 1.3 - cuspJm[0] / p.limitJ))
    return tests.every((test) => {
      const slopeGain = p.limitJ * p.focus * focusGain(test[0], cuspJm[0], p.limitJ)
      const edge = gamutEdge(test, cuspJm, focusJ, p.limitJ, slopeGain, gamma, p.lowerGamma)
      return outsideGamut([edge[0], edge[1], test[2]])
    })
  }
  const table = new Array<number>(HUES)
  for (let hue = 0; hue < HUES; hue++) {
    const cuspJm = cuspAt(hue, cusp)
    const tests = [0.01, 0.5, 0.99].map((at): V3 => [
      cuspJm[0] + (p.limitJ - cuspJm[0]) * at,
      cuspJm[1],
      hue,
    ])
    let low = 0,
      high = 0.4
    table[hue] = -1
    while (!fits(tests, cuspJm, high) && high < 5) [low, high] = [high, high + 0.4]
    while (high - low > 1e-5) {
      const sample = (high + low) / 2
      if (fits(tests, cuspJm, sample)) [high, table[hue]] = [sample, sample]
      else low = sample
    }
  }
  return [table[HUES - 1], ...table, table[0]]
}

/** The three tables for sRGB's gamut and a display of peak luminance `peak`. */
export const tablesFor = (peak: number): HueTables => {
  const cusp = cuspTable(peak)
  return { reach: reachTable(peak), cusp, gamma: gammaTable(cusp, peak) }
}
