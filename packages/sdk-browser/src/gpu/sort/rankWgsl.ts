import { POOL_AGES, POOL_RANKS, POOL_TIERS } from './rank.ts'
import { wgslConst, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { bitLength } from '../../../../math/src/wgsl/integer.ts'

/** The ranks a pool tells apart, and the rank of a slot in use: never listed (`rank.ts`). */
export const POOL_RANKS_WGSL = wgslConst('POOL_RANKS', [], `const POOL_RANKS:u32=${POOL_RANKS}u;`)

/** The age step of a slot `age` clocks old, `inUse` or more: a doubling of the age, its bit length.
 *  A pool without its own `poolAgeStep` gets this doubling; a pool that lists its own keeps this
 *  one out. */
const POOL_AGE_STEP_WGSL = wgslFn(
  'poolAgeStep',
  [bitLength],
  'fn poolAgeStep(age:u32)->u32{return bitLength(age);}',
  { weak: true },
)

/** `poolRank` (`rank.ts`; the tests run this text): `POOL_RANKS` while
 *  `age < inUse`, else the age step (`poolAgeStep`) then the tier, the finer — higher rank — tier
 *  first. Integer only. */
export const POOL_RANK_WGSL = wgslFn(
  'poolRank',
  [POOL_AGE_STEP_WGSL, POOL_RANKS_WGSL],
  `fn poolRank(age:u32,tier:u32,inUse:u32)->u32{
 if(age<inUse){return POOL_RANKS;}
 return min(poolAgeStep(age),${POOL_AGES - 1}u)*${POOL_TIERS}u+(${POOL_TIERS - 1}u-min(tier,${POOL_TIERS - 1}u));
}`,
)
