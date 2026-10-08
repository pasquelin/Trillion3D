import { quantileFloorOf } from '../packages/math/src/scalar/quantile.ts'

/** The middle value of a series — the upper of the two middle ones for an even count. */
export const median = (values: readonly number[]): number => {
  return quantileFloorOf(values, 0.5) as number
}
