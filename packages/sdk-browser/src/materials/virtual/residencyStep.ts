import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The step of the residency bias (`residencyBias.ts`): the bound its gap is taken from, and the rate it follows. */
export const MAX_BIAS = 4
const RESIDENCY_BOUND = 0.95,
  LOCKED_BOUND = 0.65,
  ADJUSTMENT_RATE = 0.2

/** A pool's pressure — the levels its visible textures give up on average — after one image: `visible`, the share of its places in use or pinned, and
 *  `locked`, the share pinned. */
export function nextResidencyBias(bias: number, visible: number, locked: number) {
  const next = bias + ADJUSTMENT_RATE * (visible - RESIDENCY_BOUND)
  return locked > LOCKED_BOUND ? 0 : clamp(next, 0, MAX_BIAS)
}
