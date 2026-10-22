import { isRecord, refusal } from './nameMatch.ts'

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
 * read from a table baked once (`bakeExposureCurve`, `exposureCurveTable`), so the exposure never waits on the curve's
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

/** The smallest time span a computed tangent divides by. */
const KINDA_SMALL = 1e-4
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

/** A key's two tangents, arriving and leaving: one left out takes the other's value for a `user`
 *  key (one tangent for both sides), else 0. */
function tangentsOf(
  o: Record<string, unknown>,
  tangentMode: ExposureCurveTangentMode,
  refuse: ReturnType<typeof refusal>,
) {
  const arrive = finite(o.arriveTangent, Number.NaN, 'arriveTangent', refuse)
  const leave = finite(o.leaveTangent, Number.NaN, 'leaveTangent', refuse)
  const left = (own: number, other: number) =>
    Number.isNaN(own) ? (tangentMode === 'user' && !Number.isNaN(other) ? other : 0) : own
  return { arriveTangent: left(arrive, leave), leaveTangent: left(leave, arrive) }
}

/** A key an option names, its settings read. */
function keyOf(key: unknown, refuse: ReturnType<typeof refusal>): ExposureCurveKey {
  const pair = Array.isArray(key) && key.length === 2
  if (!pair && !isRecord(key))
    return refuse(`each key must be [ev, compensation] or an object, got ${String(key)}`)
  const o = (pair ? { ev: key[0], compensation: key[1] } : key) as Record<string, unknown>
  const tangentMode = oneOf(o.tangentMode, TANGENT_MODES, 'auto', 'tangentMode', refuse)
  return {
    ...tangentsOf(o, tangentMode, refuse),
    ev: finite(o.ev, Number.NaN, 'ev', refuse),
    compensation: finite(o.compensation, Number.NaN, 'compensation', refuse),
    interpolation: oneOf(o.interpolation, INTERPOLATIONS, 'linear', 'interpolation', refuse),
    tangentMode,
    weightMode: oneOf(o.weightMode, WEIGHT_MODES, 'none', 'weightMode', refuse),
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
  if (!listed && !isRecord(option))
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
