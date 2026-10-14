import { bitLength } from '../../../../math/src/scalar/integers.ts'
import { POOL_AGES, POOL_RANKS, POOL_TIERS } from './rank.ts'

/** The age step a rank is made of, as `bitLength` in the kernel: one step a doubling. */
export const ageStep = (age: number) => Math.min(POOL_AGES - 1, bitLength(age))

/** CPU mirror of `poolRank` (`rankWgsl.ts`): `POOL_RANKS` while `age < inUse`, else older age step
 *  first, then the finer tier. Integer only, as the kernel. */
export const poolRank = (age: number, tier: number, inUse: number) =>
  age < inUse
    ? POOL_RANKS
    : ageStep(age) * POOL_TIERS + (POOL_TIERS - 1 - Math.min(tier, POOL_TIERS - 1))
