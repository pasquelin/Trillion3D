/**
 * Each display curve's inverse, on the CPU, by the rank `toneMap` reads: the exposed radiance
 * `toneMap` turns into the display value `y`, each channel below 1. ACES and Cineon solve their
 * rational fit's quadratic, around ACES's two matrices inverted; Reinhard is `y / (1 − y)`; AgX
 * inverts its matrices and its power, its contrast polynomial by bisection over its [0, 1] domain,
 * then its log encoding; the neutral operator undoes its shoulder at the peak, then its toe at the
 * lowest channel. `linear` and `none` keep `y`.

 */
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import { ACES, AGX, CINEON, GAMMA, NEUTRAL } from './toneCurveConstants.ts'

export type V3 = [number, number, number]
const R = TONE_MAPPING_RANK

/** `m · v`, `m` column-major 3×3. */
const apply3 = (m: readonly number[], v: readonly number[]): V3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
]
export const each = (v: readonly number[], f: (x: number, k: number) => number): V3 => [
  f(v[0], 0),
  f(v[1], 1),
  f(v[2], 2),
]

/** Bisection steps of the AgX contrast's inverse: the [0, 1] domain halved to a double's step. */
const AGX_STEPS = 52

function acesInverse(y: readonly number[]) {
  const F = ACES.fit
  const v = each(apply3(ACES.outputInverse, y), (x) => clamp(x, -F.b / F.f, 1))
  const c = each(v, (x) => {
    const a = 1 - x * F.d,
      b = F.a - x * F.e,
      q = F.b + x * F.f
    return (Math.sqrt(b * b + 4 * a * q) - b) / (2 * a)
  })
  return each(apply3(ACES.inputInverse, c), (x) => Math.max(ACES.exposureScale * x, 0))
}

function cineonInverse(y: readonly number[]) {
  const C = CINEON.fit
  return each(y, (channel) => {
    const v = Math.pow(channel, 1 / GAMMA)
    const a = C.a * (1 - v),
      b = C.b - C.c * v,
      c = C.d * v
    return (Math.sqrt(b * b + 4 * a * c) - b) / (2 * a) + CINEON.offsetValue
  })
}

/** The AgX contrast fit at `c` (`AGX.contrastFit`, highest power first). */
const agxContrast = (c: number) => AGX.contrastFit.reduce((sum, k) => sum * c + k, 0)

function agxInverse(y: readonly number[]) {
  const narrow = each(apply3(AGX.toNarrowInverse, y), (x) => Math.pow(Math.max(x, 0), 1 / GAMMA))
  const w = apply3(AGX.outsetInverse, narrow)
  const e = each(w, (target) => {
    let low = 0,
      high = 1
    for (let k = 0; k < AGX_STEPS; k++) {
      const c = 0.5 * (low + high)
      if (agxContrast(c) > target) high = c
      else low = c
    }
    return AGX.low + 0.5 * (low + high) * (AGX.high - AGX.low)
  })
  return each(
    apply3(
      AGX.intoLogInverse,
      each(e, (x) => 2 ** x),
    ),
    (x) => Math.max(x, 0),
  )
}

function neutralInverse(y: readonly number[]) {
  const M = NEUTRAL.fit
  const top = Math.max(y[0], y[1], y[2])
  let c: V3 = [y[0], y[1], y[2]]
  if (top >= M.knee) {
    const peak = M.shoulder + M.shoulderRange / (1 - top)
    const g = 1 - 1 / (M.slope * (peak - top) + 1)
    c = each(y, (x) => ((x - g * top) / (1 - g)) * (peak / top))
  }
  const m = Math.min(c[0], c[1], c[2])
  const low = Math.sqrt(Math.max(m, 0) / M.toeScale)
  const lift = m < M.offset ? low - m : M.offset
  return each(c, (x) => x + lift)
}

/** The exposed radiance the curve of rank `curve` turns into the display value `y`. */
export function toneUnmap(y: readonly number[], curve: number): V3 {
  if (curve === R.none || curve === R.linear) return [y[0], y[1], y[2]]
  if (curve === R.reinhard) return each(y, (x) => x / (1 - x))
  if (curve === R.cineon) return cineonInverse(y)
  if (curve === R.agx) return agxInverse(y)
  if (curve === R.neutral) return neutralInverse(y)
  return acesInverse(y)
}
