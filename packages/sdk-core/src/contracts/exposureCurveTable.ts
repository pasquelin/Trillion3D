import { halfRound } from '../../../math/src/float/half.ts'
import { clamp, lerp } from '../../../math/src/scalar/reals.ts'
import {
  EXPOSURE_CURVE_MAX_EV,
  EXPOSURE_CURVE_MIN_EV,
  EXPOSURE_CURVE_SAMPLES,
  type ExposureCurve,
  type ExposureCurveOption,
  resolveExposureCurve,
} from './exposureCurve.ts'
import { exposureCurveAt } from './exposureCurveEval.ts'

/** The factor of an empty table's sample: none, `2^0` for the compensation, 1 for a scale. */
const NO_COMPENSATION = 1

/** What a table keeps of the curve's value `v` at a key: the compensation's factor `2^v`, held as a 16-bit float, or the value itself. */
type Sample = (v: number) => number
const compensation: Sample = (v) => halfRound(2 ** v)
const scale: Sample = (v) => v

/**
 * The curve baked into its table, `EXPOSURE_CURVE_SAMPLES` factors by EV100 from
 * `EXPOSURE_CURVE_MIN_EV` to `EXPOSURE_CURVE_MAX_EV`, the first and the last sample at the ends:
 * sample `i` is `sample(curve there)` at `min + i · (max - min) / (samples - 1)`. No curve bakes a table of ones.
 */
function bakeExposureCurve(curve: ExposureCurve, sample: Sample) {
  const out = new Float32Array(EXPOSURE_CURVE_SAMPLES)
  const delta = (EXPOSURE_CURVE_MAX_EV - EXPOSURE_CURVE_MIN_EV) / (EXPOSURE_CURVE_SAMPLES - 1)
  for (let i = 0; i < EXPOSURE_CURVE_SAMPLES; i++)
    out[i] =
      curve === null
        ? NO_COMPENSATION
        : sample(exposureCurveAt(curve, EXPOSURE_CURVE_MIN_EV + delta * i))
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
  return lerp(table[below], table[above], at - below)
}

/** The table of no curve: ones. */
const NO_CURVE_TABLE = /* @__PURE__ */ bakeExposureCurve(null, compensation)

/** A kind of table: how a curve's value is kept, and the tables baked from each curve option a host gave, by the option object itself. */
const kind = (sample: Sample) => ({ sample, tables: new WeakMap<object, Float32Array>() })
const COMPENSATION = /* @__PURE__ */ kind(compensation)
const SCALE = /* @__PURE__ */ kind(scale)

function tableOf(of: ReturnType<typeof kind>, option: ExposureCurveOption | undefined) {
  if (!option) return NO_CURVE_TABLE
  let table = of.tables.get(option)
  if (!table)
    of.tables.set(option, (table = bakeExposureCurve(resolveExposureCurve(option), of.sample)))
  return table
}

/**
 * The table of the curve a host wrote (`ExposureCurveOption`), baked once for each option object:
 * the exposure reads it each frame, and the same object gives the same table, so a change is seen
 * by identity (write a new array or object to change the curve; an edit in place is not seen).
 * No curve (`undefined`, `null`, `false`) gives the shared table of ones. The table is shared: the
 * caller does not write it.
 * @throws TypeError naming what a curve takes when the option is not one (`resolveExposureCurve`).
 */
export const exposureCurveTable = (option: ExposureCurveOption | undefined) =>
  tableOf(COMPENSATION, option)

/**
 * The table of a curve whose values are scales, not stops (the local exposure's contrast curves): the value
 * itself at each sample, ones for none. Baked and shared as `exposureCurveTable` is.
 */
export const exposureCurveScaleTable = (option: ExposureCurveOption | undefined) =>
  tableOf(SCALE, option)
