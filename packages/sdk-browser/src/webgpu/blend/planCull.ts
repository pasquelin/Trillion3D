import { PLAN_PIPELINE_MASK } from './planEntry.ts'
import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { ranksOf } from '../../../../math/src/sequence/ranks.ts'
import { BLEND_MODES } from '../../scene/materialBlending.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'

/** THE CULL TABLE of a blend mode's pipelines, in rank order: one pipeline per cull mode
 *  (`stagePipelines.ts`), a pipeline rank its mode's rank times their count plus its cull's
 *  (`plan.ts`); the vertex stage culls by the same ranks (`facing.ts`). */
export const CULL_MODES = ['none', 'front', 'back'] as const satisfies readonly GPUCullMode[]
/** Each cull mode's rank in `CULL_MODES`, and their count. */
export const CULL_RANK = ranksOf(CULL_MODES)
const CULL_RANKS = CULL_MODES.length
/** The cull rank of pipeline rank `rank`, the rank of its blend mode (`BLEND_MODES`), and the first
 *  pipeline rank of blend mode rank `mode`. */
export const cullOf = (rank: number) => rank % CULL_RANKS
export const modeOf = (rank: number) => Math.floor(rank / CULL_RANKS)
export const modeBase = (mode: number) => mode * CULL_RANKS
/** The blend mode of pipeline rank `rank`, and the first pipeline rank of blend mode `blending`. */
export const blendingOf = (rank: number) => BLEND_MODES[modeOf(rank)]
export const pipelineBase = (blending: Blending) => modeBase(BLEND_MODES.indexOf(blending))

/** Cull mode of the entry, whoever applies it: its rank among the pipelines of its mode. */
export const planCull = (entry: number) => cullOf(entry & PLAN_PIPELINE_MASK)

/** `planCull` as the expansion kernel reads it (`expandWgsl.ts`). */
export const PLAN_CULL_WGSL = wgslFn(
  'planCull',
  [],
  `fn planCull(entry:u32)->u32{return (entry&${PLAN_PIPELINE_MASK}u)%${CULL_RANKS}u;}`,
)
