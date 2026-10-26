import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { POOL_TIERS } from './rank.ts'
import { POOL_RANK_WGSL } from './rankWgsl.ts'

/** The shipped `poolRank` (`rankWgsl.ts`) run in JavaScript: an edit of the kernel is what the
 *  tests rank by. */
export const { poolRank } = shaderRun<{
  poolRank: (age: number, tier: number, inUse: number) => number
}>(POOL_RANK_WGSL, ['poolRank'], {})

/** The age step of a slot `age` frames old: the step its rank is made of, read off the shipped
 *  rank — a step is `POOL_TIERS` ranks. */
export const ageStep = (age: number) => Math.floor(poolRank(age, 0, 0) / POOL_TIERS)

/**
 * Frames a use protects its slot for: the frame that used it and the one after, so a slot any view
 * — a light's, a view drawn beside the main one — used in the frame before is still in use, whatever
 * order the views read in.
 */
export const EVICT_IN_USE = 2
