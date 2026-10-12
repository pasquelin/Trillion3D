// The quantiles the GPU proofs report over their timings and their darkening: the maths' floor
// quantile of a sorted copy, the list itself left as is.
import { quantileFloor } from '../../../packages/math/src/scalar/quantile.ts'

/** `quantileFloor` of an unsorted list: a copy is sorted ascending first. */
export function quantileFloorOf(values: ArrayLike<number>, q: number): number | undefined {
  return quantileFloor(Float64Array.from(values).sort(), q)
}
