import { clamp } from '../../../../math/src/scalar/reals.ts'
import { LIGHT_SETTINGS } from './contracts.ts'

/** A spot's inner and outer cone half-angles, radians, from the ones asked for, as it is lit and as
 *  its shadow map is cut: the inner one held between 0 and the widest cone; the outer one at least
 *  a gap past the inner one and at most the widest cone plus that gap. */
export function spotAnglesOf(innerRad: number, outerRad: number): [number, number] {
  const { spotConeLimit: limit, spotConeGap: gap } = LIGHT_SETTINGS
  const inner = clamp(innerRad, 0, limit)
  return [inner, clamp(outerRad, inner + gap, limit + gap)]
}
