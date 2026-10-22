import { halfRound } from '../../../math/src/float/half.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import {
  EXPOSURE_CURVE_MAX_EV,
  EXPOSURE_CURVE_MIN_EV,
  EXPOSURE_CURVE_SAMPLES,
  type ExposureCurve,
} from './exposureCurve.ts'
import { exposureCurveAt } from './exposureCurveEval.ts'

/** The factor of an empty table's sample: none, `2^0`. */
const NO_COMPENSATION = 1

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
        : halfRound(2 ** exposureCurveAt(curve, EXPOSURE_CURVE_MIN_EV + delta * i))
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

/** The last resolved curve's table and the curve it was baked from. */
let baked: { readonly curve: ExposureCurve; readonly table: Float32Array } | undefined

/** The table of `curve` (`bakeExposureCurve`), baked again only when `curve` is not the object the
 *  last call was given: a resolved curve is kept as it is, so the exposure's per-frame read finds
 *  its table. The table is shared: the caller does not write it. */
export function exposureCurveTable(curve: ExposureCurve) {
  if (baked === undefined || baked.curve !== curve)
    baked = { curve, table: bakeExposureCurve(curve) }
  return baked.table
}
