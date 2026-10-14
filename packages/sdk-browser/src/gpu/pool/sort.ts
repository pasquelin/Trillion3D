import { dispatchRows } from '../dispatch/grid.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock, wgslConst } from '../../../../math/src/wgsl/decl.ts'
import { POOL_RANKS } from './rank.ts'

/** The six entry points of a pool's victim queue (`sortWgsl.ts`), in their order. */
export const POOL_SORT_STAGES = [
  'poolCount',
  'poolPlace',
  'poolGroups',
  'poolOffsets',
  'poolSpread',
  'poolScatter',
] as const
export type PoolSortStage = (typeof POOL_SORT_STAGES)[number]
/** The stages one workgroup runs: the ranks' places, the groups' offsets, the staged slots. */
const ONE_WORKGROUP: ReadonlySet<PoolSortStage> = new Set([
  'poolPlace',
  'poolOffsets',
  'poolScatter',
])

/** The sort's words: `POOL_RANKS` counts, as many places, the boundary rank and the total. */
export const POOL_SORT_BOUND = 2 * POOL_RANKS
const POOL_SORT_TOTAL = POOL_SORT_BOUND + 1
export const POOL_SORT_WORDS = POOL_SORT_TOTAL + 1

/** Slots a counting, grouping or spreading workgroup takes: one a lane of the count's. */
const POOL_LANES = 256

/** The boundary's and the total's words as the kernels name them. */
export const POOL_SORT_HEAD_WGSL = wgslBlock(
  'POOL_SORT_HEAD_WGSL',
  [],
  wgslConsts({ POOL_BOUND: POOL_SORT_BOUND, POOL_TOTAL: POOL_SORT_TOTAL }),
)

/** `POOL_LANES` as the kernels name it: the host's workgroup count and the kernels' width are one
 *  number. */
export const POOL_LANES_WGSL = wgslConst('POOL_LANES', [], wgslConsts({ POOL_LANES }))

/** The sort's scratch over at most `slots` slots and a burst of `burst`: a rank and a slot per
 *  slot staged — fewer than a burst —, then two counts per group of `POOL_LANES` slots. */
export const poolScratchWords = (slots: number, burst: number) =>
  2 * burst + 2 * workgroupCount(slots, POOL_LANES)

/**
 * A pool's victim queue on `pass`, its bind group already set, each stage's pipeline read off
 * `pipelineOf`: over the `slots` the pool may hold — those past its count leave at once —, the
 * stages a group of slots runs in rows of `width` workgroups, the others in one workgroup.
 */
export function encodePoolSort(
  pass: GPUComputePassEncoder,
  pipelineOf: (stage: PoolSortStage) => GPUComputePipeline,
  slots: number,
  width: number,
) {
  const groups = workgroupCount(slots, POOL_LANES)
  for (const stage of POOL_SORT_STAGES) {
    pass.setPipeline(pipelineOf(stage))
    if (ONE_WORKGROUP.has(stage)) pass.dispatchWorkgroups(1)
    else dispatchRows(pass, groups, 1, width)
  }
}
