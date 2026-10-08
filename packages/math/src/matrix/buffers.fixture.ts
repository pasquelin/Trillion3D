// The buffers a rewrite proof writes into: every kind an output of the matrix kernel accepts.
import type { NumberSink } from './matrix4.ts'

/** `values` as buffer kind `kind`: 0 `Float64Array`, 1 `Float32Array`, 2 a plain array. */
export const typed = (kind: number, values: ArrayLike<number>): NumberSink & ArrayLike<number> =>
  kind === 0
    ? Float64Array.from(values)
    : kind === 1
      ? Float32Array.from(values)
      : Array.from(values)

/** Eighteen sentinels: the two past a matrix's sixteen catch a stray write. */
export const SENTINELS = new Float64Array(18).fill(7)
