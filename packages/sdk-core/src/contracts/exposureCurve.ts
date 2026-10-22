import { PI } from '../../../math/src/constants.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import { length2 } from '../../../math/src/vector/vector.ts'
import { refusal } from './nameMatch.ts'

/**
 * The exposure compensation curve of the automatic exposure: stops added to the target, by how
 * bright the scene is. A list of keys, each at an EV100 — the mean luminance over middle grey, one
 * stop a doubling — with the stops it adds there (0 no change, -1 twice as dark, 1 twice as
 * bright). A key is a pair `[ev, compensation]`, linear to the next, or an object holding more
 * (`ExposureCurveKeyObject`): how it runs to the next key (`interpolation`: linear, constant, or
 * cubic by tangents), the tangents and how they are set (`tangentMode`: auto, user, break), and
 * weights on them. Before the first key and after the last the curve follows an extrapolation
 * (`before`, `after`; held by default). No curve (the default) is no compensation. The curve
 * multiplies the exposure's bias (`exposureBias`, `exposureOptions.ts`) by `2^compensation`; it is
 * read from a table baked once (`bakeExposureCurve`), so the exposure never waits on the curve's
 * own evaluation.
 */

/** How a key runs to the next: a line, a step, or a cubic curve shaped by the tangents. */
export type ExposureCurveInterpolation = 'linear' | 'constant' | 'cubic'
/** How a key's tangents are set: `auto` from its neighbours (both the same, flat at the ends),
 *  `user` one tangent for both sides, `break` one for each side; `none` and `smartAuto` keep the
 *  tangents as written. */
export type ExposureCurveTangentMode = 'auto' | 'user' | 'break' | 'none' | 'smartAuto'
/** Which of a key's tangents carry a weight (the length of the tangent's handle). */
export type ExposureCurveWeightMode = 'none' | 'arrive' | 'leave' | 'both'
/** What a curve does outside its keys: `cycle` repeats it, `cycleWithOffset` repeats it from the
 *  value the last cycle ended at, `oscillate` repeats it back and forth, `linear` goes on along the
 *  first or last segment's line, `constant` holds the end value. `none` reads as a cycle, as the
 *  reference does. */
export type ExposureCurveExtrapolation =
  'cycle' | 'cycleWithOffset' | 'oscillate' | 'linear' | 'constant' | 'none'

/** A key with its settings, each but `ev` and `compensation` optional: linear, tangents 0, auto
 *  tangents, no weights. With `tangentMode` `user`, a tangent left out takes the other's value. */
export interface ExposureCurveKeyObject {
  ev: number
  compensation: number
  interpolation?: ExposureCurveInterpolation
  tangentMode?: ExposureCurveTangentMode
  weightMode?: ExposureCurveWeightMode
  arriveTangent?: number
  leaveTangent?: number
  arriveWeight?: number
  leaveWeight?: number
}
/** A key as a host writes it: the pair `[ev, compensation]`, linear, or an object. */
export type ExposureCurveKeyOption =
  readonly [ev: number, compensation: number] | ExposureCurveKeyObject
/** A curve with its extrapolations (both `constant` where left out). */
export interface ExposureCurveObject {
  keys: readonly ExposureCurveKeyOption[]
  before?: ExposureCurveExtrapolation
  after?: ExposureCurveExtrapolation
}
/** The curve as a host writes it: keys in any order, or an object; `null` or `false` name none. */
export type ExposureCurveOption =
  readonly ExposureCurveKeyOption[] | ExposureCurveObject | null | false

/** A key resolved: every setting set, the tangents of an `auto` key computed. */
export interface ExposureCurveKey {
  ev: number
  compensation: number
  interpolation: ExposureCurveInterpolation
  tangentMode: ExposureCurveTangentMode
  weightMode: ExposureCurveWeightMode
  arriveTangent: number
  leaveTangent: number
  arriveWeight: number
  leaveWeight: number
}
/** The curve resolved: keys by rising EV100, none at the same EV100; `null` for none. */
export type ExposureCurve = {
  keys: readonly ExposureCurveKey[]
  before: ExposureCurveExtrapolation
  after: ExposureCurveExtrapolation
} | null

/** Samples of the baked table. */
export const EXPOSURE_CURVE_SAMPLES = 64
/** The EV100 of the table's first sample. */
export const EXPOSURE_CURVE_MIN_EV = -10
/** The EV100 of the table's last sample. */
export const EXPOSURE_CURVE_MAX_EV = 20

/** The factor of an empty table's sample: none, `2^0`. */
const NO_COMPENSATION = 1
/** The smallest time span a computed tangent divides by. */
const KINDA_SMALL = 1e-4
/** How near zero, or to each other, two roots of the weighted cubic are taken for equal. */
const SMALL = 1e-8

const INTERPOLATIONS = ['linear', 'constant', 'cubic'] as const
const TANGENT_MODES = ['auto', 'user', 'break', 'none', 'smartAuto'] as const
const WEIGHT_MODES = ['none', 'arrive', 'leave', 'both'] as const
const EXTRAPOLATIONS = [
  'cycle',
  'cycleWithOffset',
  'oscillate',
  'linear',
  'constant',
  'none',
] as const

/** `Math.f16round` (not in every TypeScript library): a number as the nearest 16-bit float, ties
 *  to even, the table's storage. */
const roundToHalf = (Math as unknown as { f16round(x: number): number }).f16round

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `value` as one of `names`, or `fallback` when left out. */
function oneOf<T extends string>(
  value: unknown,
  names: readonly T[],
  fallback: T,
  what: string,
  refuse: ReturnType<typeof refusal>,
): T {
  if (value === undefined) return fallback
  if (!names.includes(value as T))
    return refuse(`${what} must be one of ${names.join(', ')}, got ${String(value)}`)
  return value as T
}

/** `value` as a finite number, `fallback` when left out. */
function finite(
  value: unknown,
  fallback: number,
  what: string,
  refuse: ReturnType<typeof refusal>,
) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value))
    return refuse(`${what} must be a finite number, got ${String(value)}`)
  return value
}

/** A key an option names, its settings read. */
function keyOf(key: unknown, refuse: ReturnType<typeof refusal>): ExposureCurveKey {
  const pair = Array.isArray(key) && key.length === 2
  if (!pair && !isObject(key))
    return refuse(`each key must be [ev, compensation] or an object, got ${String(key)}`)
  const o = (pair ? { ev: key[0], compensation: key[1] } : key) as Record<string, unknown>
  const tangentMode = oneOf(o.tangentMode, TANGENT_MODES, 'auto', 'tangentMode', refuse)
  const arriveTangent = finite(o.arriveTangent, Number.NaN, 'arriveTangent', refuse)
  const leaveTangent = finite(o.leaveTangent, Number.NaN, 'leaveTangent', refuse)
  const unified = tangentMode === 'user'
  return {
    ev: finite(o.ev, Number.NaN, 'ev', refuse),
    compensation: finite(o.compensation, Number.NaN, 'compensation', refuse),
    interpolation: oneOf(o.interpolation, INTERPOLATIONS, 'linear', 'interpolation', refuse),
    tangentMode,
    weightMode: oneOf(o.weightMode, WEIGHT_MODES, 'none', 'weightMode', refuse),
    arriveTangent: Number.isNaN(arriveTangent)
      ? unified && !Number.isNaN(leaveTangent)
        ? leaveTangent
        : 0
      : arriveTangent,
    leaveTangent: Number.isNaN(leaveTangent)
      ? unified && !Number.isNaN(arriveTangent)
        ? arriveTangent
        : 0
      : leaveTangent,
    arriveWeight: finite(o.arriveWeight, 0, 'arriveWeight', refuse),
    leaveWeight: finite(o.leaveWeight, 0, 'leaveWeight', refuse),
  }
}

/**
 * The tangents of the `auto` keys, from their neighbours, as the reference sets them after an edit:
 * the first key leaves flat; an inner cubic key takes the slope between its neighbours' values over
 * their span (arriving and leaving the same); the last cubic key arrives flat; around a constant
 * segment the tangent that meets it is zero. Keys of another tangent mode keep theirs.
 */
function setAutoTangents(keys: ExposureCurveKey[]) {
  const last = keys.length - 1
  keys.forEach((key, i) => {
    let { arriveTangent, leaveTangent } = key
    if (i === 0) {
      if (i < last && key.tangentMode === 'auto') leaveTangent = 0
    } else if (i < last) {
      const previous = keys[i - 1]
      const next = keys[i + 1]
      if (key.interpolation === 'cubic' && key.tangentMode === 'auto') {
        arriveTangent =
          (key.compensation - previous.compensation + (next.compensation - key.compensation)) /
          Math.max(KINDA_SMALL, next.ev - previous.ev)
        leaveTangent = arriveTangent
      } else if (previous.interpolation === 'constant' || key.interpolation === 'constant') {
        leaveTangent = 0
        if (previous.interpolation !== 'cubic') arriveTangent = 0
      }
    } else if (key.interpolation === 'cubic' && key.tangentMode === 'auto') arriveTangent = 0
    key.arriveTangent = arriveTangent
    key.leaveTangent = leaveTangent
  })
}

/**
 * The curve an option names: `undefined`, `null`, `false` and an empty list none (`null`); a list
 * of keys, or an object of `keys` with its `before` and `after`, as a curve with its keys sorted by
 * EV100 and the tangents of its auto keys set.
 * @throws TypeError naming what it takes when a key, a setting or an extrapolation is not as
 *   described, or two keys share an EV100.
 */
export function resolveExposureCurve(option?: ExposureCurveOption): ExposureCurve {
  const refuse = refusal('exposureCurve')
  if (option === undefined || option === null || option === false) return null
  const listed = Array.isArray(option)
  if (!listed && !isObject(option))
    return refuse(`must be a list of keys or an object of keys, got ${String(option)}`)
  const list = listed ? option : (option as ExposureCurveObject).keys
  if (!Array.isArray(list)) return refuse('keys must be a list')
  if (list.length === 0) return null
  const extra: Partial<ExposureCurveObject> = listed ? {} : (option as ExposureCurveObject)
  const keys = list.map((key: unknown) => keyOf(key, refuse))
  keys.sort((a, b) => a.ev - b.ev)
  for (let i = 1; i < keys.length; i++)
    if (keys[i].ev === keys[i - 1].ev) return refuse(`two keys share the EV100 ${keys[i].ev}`)
  setAutoTangents(keys)
  return {
    keys,
    before: oneOf(extra.before, EXTRAPOLATIONS, 'constant', 'before', refuse),
    after: oneOf(extra.after, EXTRAPOLATIONS, 'constant', 'after', refuse),
  }
}

const lerp = (a: number, b: number, t: number) => a + t * (b - a)

/** The cubic Bezier of four points at `t`, by repeated mixing. */
function bezier(p0: number, p1: number, p2: number, p3: number, t: number) {
  const p01 = lerp(p0, p1, t)
  const p12 = lerp(p1, p2, t)
  const p23 = lerp(p2, p3, t)
  return lerp(lerp(p01, p12, t), lerp(p12, p23, t), t)
}

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
  let at: number
  if (roots.length === 1) at = roots[0]
  else {
    at = -Number.MAX_VALUE
    for (const root of roots)
      if (
        (root > 0 || Math.abs(root) <= SMALL) &&
        (root < 1 || Math.abs(root - 1) <= SMALL) &&
        (at < 0 || root > at)
      )
        at = root
    if (at === -Number.MAX_VALUE) at = 0
  }
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
    if (curve.before === 'linear' && last > 0) {
      const dt = keys[1].ev - keys[0].ev
      value =
        Math.abs(dt) <= SMALL
          ? keys[0].compensation
          : ((keys[1].compensation - keys[0].compensation) / dt) * (at - keys[0].ev) +
            keys[0].compensation
    } else value = keys[0].compensation
  } else if (at <= keys[last].ev) {
    let upper = 1
    while (upper < last && at >= keys[upper].ev) upper++
    value = between(keys[upper - 1], keys[upper], at)
  } else if (curve.after === 'linear') {
    const dt = keys[last - 1].ev - keys[last].ev
    value =
      Math.abs(dt) <= SMALL
        ? keys[last].compensation
        : ((keys[last - 1].compensation - keys[last].compensation) / dt) * (at - keys[last].ev) +
          keys[last].compensation
  } else value = keys[last].compensation
  return value + remapped.offset
}

/**
 * The curve baked into its table, `EXPOSURE_CURVE_SAMPLES` factors by EV100 from
 * `EXPOSURE_CURVE_MIN_EV` to `EXPOSURE_CURVE_MAX_EV`, the first and the last sample at the ends:
 * sample `i` is `2^compensation` at `min + i · (max - min) / (samples - 1)`, held as a 16-bit
 * float. No curve bakes a table of ones. Written into `out` when given (its first
 * `EXPOSURE_CURVE_SAMPLES` words), else a new array.
 */
export function bakeExposureCurve(
  curve: ExposureCurve,
  out: Float32Array = new Float32Array(EXPOSURE_CURVE_SAMPLES),
) {
  const delta = (EXPOSURE_CURVE_MAX_EV - EXPOSURE_CURVE_MIN_EV) / (EXPOSURE_CURVE_SAMPLES - 1)
  for (let i = 0; i < EXPOSURE_CURVE_SAMPLES; i++)
    out[i] =
      curve === null
        ? NO_COMPENSATION
        : roundToHalf(2 ** exposureCurveAt(curve, EXPOSURE_CURVE_MIN_EV + delta * i))
  return out
}

/** The factor a baked `table` gives at `ev`: the samples read linearly between neighbours, the ends
 *  held — the read the exposure's shader makes (`curveWgsl.ts`). */
export function exposureCurveFactor(table: ArrayLike<number>, ev: number) {
  const span = EXPOSURE_CURVE_MAX_EV - EXPOSURE_CURVE_MIN_EV
  const last = EXPOSURE_CURVE_SAMPLES - 1
  const at = clamp(((ev - EXPOSURE_CURVE_MIN_EV) * last) / span, 0, last)
  const below = Math.floor(at)
  const above = Math.min(below + 1, last)
  return table[below] + (table[above] - table[below]) * (at - below)
}
