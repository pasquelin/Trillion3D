import { PLAN_PIPELINE_MASK } from './planEntry.ts'
import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/** THE CULL TABLE of a blend mode's pipelines, in rank order: one pipeline per cull mode
 *  (`stagePipelines.ts`), a pipeline rank its mode's rank times their count plus its cull's
 *  (`plan.ts`); the vertex stage culls by the same ranks (`facing.ts`). */
export const CULL_MODES = ['none', 'front', 'back'] as const satisfies readonly GPUCullMode[]
/** Each cull mode's rank in `CULL_MODES`, and their count. */
export const CULL_RANK = Object.fromEntries(CULL_MODES.map((mode, rank) => [mode, rank])) as Record<
  (typeof CULL_MODES)[number],
  number
>
const CULL_RANKS = CULL_MODES.length
/** The cull rank of pipeline rank `rank`, the rank of its blend mode (`BLEND_MODES`), and the first
 *  pipeline rank of blend mode rank `mode`. */
export const cullOf = (rank: number) => rank % CULL_RANKS
export const modeOf = (rank: number) => Math.floor(rank / CULL_RANKS)
export const modeBase = (mode: number) => mode * CULL_RANKS

/** Cull mode of the entry, whoever applies it: its rank among the pipelines of its mode. */
export const planCull = (entry: number) => cullOf(entry & PLAN_PIPELINE_MASK)

/** `planCull` as the expansion kernel reads it (`expandWgsl.ts`). */
export const PLAN_CULL_WGSL = wgslFn(
  'planCull',
  [],
  `fn planCull(entry:u32)->u32{return (entry&${PLAN_PIPELINE_MASK}u)%${CULL_RANKS}u;}`,
)
