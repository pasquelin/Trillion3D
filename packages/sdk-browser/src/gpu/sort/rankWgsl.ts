import { POOL_RANKS } from './rank.ts'
import { wgslConst } from '../../../../math/src/wgsl/decl.ts'

/** The ranks a pool tells apart, and the rank of a slot in use: never listed (`rank.ts`). */
export const POOL_RANKS_WGSL = wgslConst('POOL_RANKS', [], `const POOL_RANKS:u32=${POOL_RANKS}u;`)
