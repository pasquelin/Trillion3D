/**
 * The film curve (`filmCurveWgsl.ts`) on the CPU, and its inverse: the exposed radiance the curve
 * turns into a display-linear colour, what a mirror needs to show the background as the display
 * shows it (`toneUnmap.ts`). The chain has no closed form — the glow and the red modifier follow
 * the colour's own hue and saturation —, so the inverse is solved: a damped least-squares descent
 * (Levenberg–Marquardt) on the logarithm of the radiance, which keeps it above zero, from the
 * grey curve's inverse of each channel — exact for any grey, close for the rest. A colour past
 * what the curve shows, which its desaturations and its cut channels never reach, comes back as
 * the nearest radiance the descent finds.
 */
import { clamp, mix, saturate } from '../../../math/src/scalar/reals.ts'
import { RAD2DEG, SQRT3 } from '../../../math/src/constants.ts'
import { applyMatrix3Vector3 } from '../../../math/src/vector/vector.ts'
import { FILM } from './filmCurveConstants.ts'

type V3 = [number, number, number]
const N = FILM.numbers
/** `m · v`, `m` column-major 3×3. */
const times = (m: readonly number[], v: readonly number[]) =>
  applyMatrix3Vector3<V3>([0, 0, 0], m, v[0], v[1], v[2])
const luma = (v: readonly number[]) => N.luma[0] * v[0] + N.luma[1] * v[1] + N.luma[2] * v[2]
/** `a` toward `b` by `t`, channel by channel. */
const blend = (a: readonly number[], b: readonly number[], t: number): V3 => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
]
const positive = (v: readonly number[]): V3 => [
  Math.max(v[0], 0),
  Math.max(v[1], 0),
  Math.max(v[2], 0),
]
/** `v` pulled toward its own luminance: all of it at 0, none at 1. */
const desaturate = (v: readonly number[], amount: number) => {
  const grey = luma(v)
  return blend([grey, grey, grey], v, amount)
}

/** The curve of one channel at a base-ten logarithm of luminance: the toe and the shoulder,
 *  blended where they overlap, the straight run where neither holds. */
function response(logc: number) {
  const { slope, toeMatch, shoulderMatch, toeScale, shoulderScale } = FILM
  const toe =
    -FILM.blackClip + (2 * toeScale) / (1 + Math.exp(((-2 * slope) / toeScale) * (logc - toeMatch)))
  const shoulder =
    1 +
    FILM.whiteClip -
    (2 * shoulderScale) / (1 + Math.exp(((2 * slope) / shoulderScale) * (logc - shoulderMatch)))
  const straight = slope * (logc + FILM.straightMatch)
  const low = logc < toeMatch ? toe : straight
  const high = logc > shoulderMatch ? shoulder : straight
  let t = saturate((logc - toeMatch) / (shoulderMatch - toeMatch))
  if (FILM.turned) t = 1 - t
  return mix(low, high, (3 - 2 * t) * t * t)
}

/** The glow on a dark saturated colour and the pull of the reds toward their pivot, in the
 *  grading gamut (`filmGrading`, `filmCurveWgsl.ts`). */
function grading([r, g, b]: readonly number[]): V3 {
  const high = Math.max(r, g, b)
  const saturation =
    (Math.max(high, 1e-10) - Math.max(Math.min(r, g, b), 1e-10)) / Math.max(high, 1e-2)
  const spread = Math.sqrt(Math.max(b * (b - g) + g * (g - r) + r * (r - b), 0))
  const lightness = (b + g + r + 1.75 * spread) / 3
  const x = (saturation - 0.4) / 0.2
  const bend = Math.max(1 - Math.abs(0.5 * x), 0)
  const gain = FILM.glow.gain * 0.5 * (1 + Math.sign(x) * (1 - bend * bend))
  const { middle } = FILM.glow
  let glow = gain
  if (lightness >= 2 * middle) glow = 0
  else if (lightness > (2 / 3) * middle) glow = gain * (middle / lightness - 0.5)
  const lit: V3 = [r * (1 + glow), g * (1 + glow), b * (1 + glow)]
  let hue = 0
  if (!(lit[0] === lit[1] && lit[1] === lit[2]))
    hue = RAD2DEG * Math.atan2(SQRT3 * (lit[1] - lit[2]), 2 * lit[0] - lit[1] - lit[2])
  if (hue < 0) hue += 360
  let centred = clamp(hue, 0, 360)
  if (centred > 180) centred -= 360
  const near = saturate(1 - Math.abs((2 * centred) / FILM.red.width))
  const weight = (near * near * (3 - 2 * near)) ** 2
  lit[0] += weight * saturation * (FILM.red.pivot - lit[0]) * (1 - FILM.red.scale)
  return lit
}

/** The film curve on `color`, exposed linear sRGB radiance: display-linear sRGB before the cut to
 *  [0, 1], which can lie outside it. The twin of `filmicCurve` (`filmCurveWgsl.ts`) up to its last
 *  clamp. */
function filmic(color: readonly number[]): V3 {
  let c = times(N.srgbToWorking, positive(color))
  const l = Math.max(luma(c), 1e-10)
  const away = c.map((x) => x / l - 1)
  const widen =
    (1 - 2 ** (-4 * (away[0] ** 2 + away[1] ** 2 + away[2] ** 2))) *
    (1 - 2 ** (-4 * FILM.expandGamut * luma(c) ** 2))
  c = positive(blend(c, times(N.expand, c), widen))
  c = blend(c, times(N.blue, c), FILM.blueCorrection)
  const w = desaturate(
    positive(times(N.gradingToWorking, grading(times(N.workingToGrading, c)))),
    FILM.preDesaturate,
  )
  const toned = desaturate(
    w.map((x) => response(Math.log10(Math.max(x, 1e-20)))),
    FILM.postDesaturate,
  )
  c = blend(c, positive(toned), FILM.curveAmount)
  return times(N.workingToSrgb, blend(c, times(N.blueBack, c), FILM.blueCorrection))
}

/** The luminance of a grey that the curve turns into the grey `t`: one channel's curve, inverted
 *  by bisection on its logarithm — it only rises. */
function greyInverse(t: number) {
  let low = -20,
    high = 12
  if (t <= response(low)) return 10 ** low
  if (t >= response(high)) return 10 ** high
  for (let k = 0; k < 64; k++) {
    const mid = 0.5 * (low + high)
    if (response(mid) < t) low = mid
    else high = mid
  }
  return 10 ** (0.5 * (low + high))
}

/** The radiance the descent keeps within, as logarithms; past the largest a colour is white
 *  anyway. */
const SMALLEST = Math.log(1e-12),
  LARGEST = Math.log(1e9)
/** The finite differences' step, in logarithm of radiance. */
const PROBE = 1e-5
/** Steps of the descent, and the squared distance to the colour it stops under: far under the
 *  least step of a display byte. */
const STEPS = 80,
  CLOSE = 1e-16
/** The most a step moves a logarithm. */
const REACH = 2

/** The determinant of a row-major 3×3 matrix. */
const detOf = (m: readonly number[]) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[1] * (m[3] * m[8] - m[5] * m[6]) +
  m[2] * (m[3] * m[7] - m[4] * m[6])

/** Solves `a · x = b`, `a` row-major 3×3, by Cramer's rule; `undefined` where it is singular. */
function solve(a: readonly number[], b: readonly number[]) {
  const det = detOf(a)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return undefined
  return [0, 1, 2].map((k) => {
    const swapped = a.slice()
    for (let row = 0; row < 3; row++) swapped[row * 3 + k] = b[row]
    return detOf(swapped) / det
  })
}

/** The exposed radiance the film curve turns into the display-linear colour `y`, each channel in
 *  [0, 1]. */
export function filmicInverse(y: readonly number[]): V3 {
  if (y[0] <= 0 && y[1] <= 0 && y[2] <= 0) return [0, 0, 0]
  // How far the curve's colour lies from `y`, channel by channel: past the cut that the display
  // makes at 0 and at 1, a channel is as near as it can be, so the descent never rests on a plateau.
  const miss = (u: readonly number[]) => {
    const shown = filmic([Math.exp(u[0]), Math.exp(u[1]), Math.exp(u[2])])
    return shown.map((value, k) =>
      y[k] <= 0 ? Math.max(value, 0) : y[k] >= 1 ? Math.min(value - 1, 0) : value - y[k],
    )
  }
  const squared = (r: readonly number[]) => r[0] * r[0] + r[1] * r[1] + r[2] * r[2]
  let u = [0, 1, 2].map((k) => clamp(Math.log(greyInverse(y[k])), SMALLEST, LARGEST))
  let r = miss(u),
    cost = squared(r),
    damping = 1e-3
  for (let step = 0; step < STEPS && cost > CLOSE; step++) {
    // The Jacobian's columns by central differences: what each logarithm moves each channel by.
    const columns = [0, 1, 2].map((k) => {
      const ahead = miss(u.map((x, i) => (i === k ? x + PROBE : x)))
      const behind = miss(u.map((x, i) => (i === k ? x - PROBE : x)))
      return ahead.map((value, i) => (value - behind[i]) / (2 * PROBE))
    })
    const dot = (a: readonly number[], b: readonly number[]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const normal = columns.flatMap((a) => columns.map((b) => dot(a, b)))
    const slope = columns.map((column) => dot(column, r))
    let moved = false
    for (let tries = 0; tries < 12 && !moved; tries++) {
      const damped = normal.map((value, at) =>
        at % 4 === 0 ? value * (1 + damping) + 1e-12 : value,
      )
      const delta = solve(damped, [-slope[0], -slope[1], -slope[2]])
      const next = delta?.map((d, k) => clamp(u[k] + clamp(d, -REACH, REACH), SMALLEST, LARGEST))
      const nextMiss = next && miss(next)
      if (next && nextMiss && squared(nextMiss) < cost) {
        u = next
        r = nextMiss
        cost = squared(nextMiss)
        damping = Math.max(damping / 3, 1e-12)
        moved = true
      } else damping *= 4
    }
    if (!moved) break
  }
  return [Math.exp(u[0]), Math.exp(u[1]), Math.exp(u[2])]
}
