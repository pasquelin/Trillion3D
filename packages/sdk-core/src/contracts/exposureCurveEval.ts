import { PI } from '../../../math/src/constants.ts'
import { bezier, lerp } from '../../../math/src/scalar/reals.ts'
import { length2 } from '../../../math/src/vector/vector.ts'
import type { ExposureCurve, ExposureCurveKey } from './exposureCurve.ts'

/** How near zero, or to each other, two roots of the weighted cubic are taken for equal. */
const SMALL = 1e-8

const cbrt = (x: number) => (x > 0 ? x ** (1 / 3) : x < 0 ? -((-x) ** (1 / 3)) : 0)

/** The real roots of `c[3]·x³ + c[2]·x² + c[1]·x + c[0]`, by Cardano's formula. */
function solveCubic(c: readonly number[]) {
  const denominator = c[3] !== 0 ? c[3] : SMALL * SMALL
  const a = c[2] / denominator
  const b = c[1] / denominator
  const d = c[0] / denominator
  const p = (1 / 3) * ((-1 / 3) * a * a + b)
  const q = (1 / 2) * ((2 / 27) * a * a * a - (1 / 3) * a * b + d)
  const cubeOfP = p * p * p
  const discriminant = q * q + cubeOfP
  let roots: number[]
  if (Math.abs(discriminant) <= SMALL) {
    if (Math.abs(q) <= SMALL) roots = [0]
    else {
      const u = cbrt(-q)
      roots = [2 * u, -u]
    }
  } else if (discriminant < 0) {
    const phi = (1 / 3) * Math.acos(-q / Math.sqrt(-cubeOfP))
    const t = 2 * Math.sqrt(-p)
    roots = [t * Math.cos(phi), -t * Math.cos(phi + PI / 3), -t * Math.cos(phi - PI / 3)]
  } else {
    const root = Math.sqrt(discriminant)
    roots = [cbrt(root - q) - cbrt(root + q)]
  }
  return roots.map((root) => root - (1 / 3) * a)
}

/** Of several roots of the time, the greatest inside [0, 1] (within `SMALL` of its ends), 0 where
 *  none is; a root held so far that is negative (within `SMALL` of 0) gives way to the next. */
function greatestInside(roots: readonly number[]) {
  const inside = (root: number) =>
    (root > 0 || Math.abs(root) <= SMALL) && (root < 1 || Math.abs(root - 1) <= SMALL)
  const best = roots
    .filter(inside)
    .reduce((held, root) => (held < 0 || root > held ? root : held), -Number.MAX_VALUE)
  return best === -Number.MAX_VALUE ? 0 : best
}

/** The segment from `k1` to `k2` at `ev` when a tangent carries a weight: the handles set at their
 *  angle and weighted length, the Bezier's time solved for `ev`, its value read there. */
function weightedBetween(k1: ExposureCurveKey, k2: ExposureCurveKey, ev: number) {
  const third = 1 / 3
  const alpha = (ev - k1.ev) / (k2.ev - k1.ev)
  const x = k2.ev - k1.ev
  const leaveAngle = Math.atan(k1.leaveTangent)
  const leaveWeight =
    k1.weightMode === 'none' || k1.weightMode === 'arrive'
      ? length2(x, k1.leaveTangent * x) * third
      : k1.leaveWeight
  const handle1 = [
    Math.cos(leaveAngle) * leaveWeight + k1.ev,
    Math.sin(leaveAngle) * leaveWeight + k1.compensation,
  ]
  const arriveAngle = Math.atan(k2.arriveTangent)
  const arriveWeight =
    k2.weightMode === 'none' || k2.weightMode === 'leave'
      ? length2(x, k2.arriveTangent * x) * third
      : k2.arriveWeight
  const handle2 = [
    -Math.cos(arriveAngle) * arriveWeight + k2.ev,
    -Math.sin(arriveAngle) * arriveWeight + k2.compensation,
  ]
  // The Bezier of the times, 0, n1, n2, 1, in the power basis (t³ t² t 1).
  const n1 = (handle1[0] - k1.ev) / x
  const n2 = (handle2[0] - k1.ev) / x
  const e = n1
  const f = n2 - n1
  const g = 1 - n2
  const h = f - e
  const coeff = [-alpha, 3 * e, 3 * h, g - f - h]
  const roots = solveCubic(coeff)
  const at = roots.length === 1 ? roots[0] : greatestInside(roots)
  return bezier(k1.compensation, handle1[1], handle2[1], k2.compensation, at)
}

/** The segment from `k1` to `k2` at `ev`, by `k1`'s interpolation. */
function between(k1: ExposureCurveKey, k2: ExposureCurveKey, ev: number) {
  const span = k2.ev - k1.ev
  if (!(span > 0)) return k1.compensation
  if (k1.interpolation === 'constant') return ev < k2.ev ? k1.compensation : k2.compensation
  const alpha = (ev - k1.ev) / span
  if (k1.interpolation === 'linear') return lerp(k1.compensation, k2.compensation, alpha)
  const leaves = k1.weightMode === 'none' || k1.weightMode === 'arrive'
  const arrives = k2.weightMode === 'none' || k2.weightMode === 'leave'
  if (leaves && arrives) {
    const third = 1 / 3
    return bezier(
      k1.compensation,
      k1.compensation + k1.leaveTangent * span * third,
      k2.compensation - k2.arriveTangent * span * third,
      k2.compensation,
      alpha,
    )
  }
  return weightedBetween(k1, k2, ev)
}

/** `ev` brought into the keys' span by an extrapolation that repeats the curve, and the value the
 *  repeat adds: the reference's cycle of time, with its offset or its flip. */
function remapEv(curve: NonNullable<ExposureCurve>, ev: number) {
  const { keys } = curve
  const first = keys[0]
  const last = keys[keys.length - 1]
  const before = ev <= first.ev
  if (keys.length < 2 || (!before && ev < last.ev)) return { ev, offset: 0 }
  const extrapolation = before ? curve.before : curve.after
  if (extrapolation === 'linear' || extrapolation === 'constant') return { ev, offset: 0 }
  const duration = last.ev - first.ev
  let at = ev
  let count = 0
  if (at > last.ev) {
    count = Math.floor((last.ev - at) / duration)
    at += duration * count
  } else if (at < first.ev) {
    count = Math.floor((at - first.ev) / duration)
    at -= duration * count
  }
  if (at === last.ev && ev < first.ev) at = first.ev
  if (at === first.ev && ev > last.ev) at = last.ev
  count = Math.abs(count)
  let offset = 0
  if (extrapolation === 'cycleWithOffset')
    offset =
      (before ? first.compensation - last.compensation : last.compensation - first.compensation) *
      count
  else if (extrapolation === 'oscillate' && count % 2 === 1) at = first.ev + (last.ev - at)
  return { ev: at, offset }
}

/** The line through the key `from` and the key `toward` at `at`; the key's value where they sit
 *  within `SMALL` of one another. */
function lineFrom(from: ExposureCurveKey, toward: ExposureCurveKey, at: number) {
  const dt = toward.ev - from.ev
  return Math.abs(dt) <= SMALL
    ? from.compensation
    : ((toward.compensation - from.compensation) / dt) * (at - from.ev) + from.compensation
}

/**
 * The compensation in stops `curve` gives at `ev`, as the reference evaluates a curve: the EV100
 * repeated into the keys' span by a cycling extrapolation; before the first key and after the last,
 * the end value, or the line of the first or last segment; between two keys, by the first one's
 * interpolation. 0 for none.
 */
export function exposureCurveAt(curve: ExposureCurve, ev: number) {
  if (curve === null || curve.keys.length === 0) return 0
  const { keys } = curve
  const last = keys.length - 1
  const remapped = remapEv(curve, ev)
  const at = remapped.ev
  let value: number
  if (last === 0 || at < keys[0].ev) {
    value =
      curve.before === 'linear' && last > 0 ? lineFrom(keys[0], keys[1], at) : keys[0].compensation
  } else if (at <= keys[last].ev) {
    let upper = 1
    while (upper < last && at >= keys[upper].ev) upper++
    value = between(keys[upper - 1], keys[upper], at)
  } else
    value =
      curve.after === 'linear' ? lineFrom(keys[last], keys[last - 1], at) : keys[last].compensation
  return value + remapped.offset
}
