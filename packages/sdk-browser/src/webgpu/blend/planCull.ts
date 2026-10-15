import { PLAN_PIPELINE_MASK } from './planEntry.ts'
import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/** Pipelines of one blend mode, one per cull rank — none, front, back —: a pipeline rank is its
 *  mode's rank times this, plus its cull's (`plan.ts`). */
export const CULL_RANKS = 3
/** The cull rank of pipeline rank `rank`, and the rank of its blend mode (`BLEND_MODES`). */
export const cullOf = (rank: number) => rank % CULL_RANKS
export const modeOf = (rank: number) => Math.floor(rank / CULL_RANKS)

/** Cull mode of the entry, whoever applies it: its rank among the three pipelines of its mode. */
export const planCull = (entry: number) => cullOf(entry & PLAN_PIPELINE_MASK)

/** `planCull` as the expansion kernel reads it (`expandWgsl.ts`). */
export const PLAN_CULL_WGSL = wgslFn(
  'planCull',
  [],
  `fn planCull(entry:u32)->u32{return (entry&${PLAN_PIPELINE_MASK}u)%${CULL_RANKS}u;}`,
)
