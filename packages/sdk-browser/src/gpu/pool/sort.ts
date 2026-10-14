import { dispatchRows } from '../dispatch/grid.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock, wgslConst } from '../../../../math/src/wgsl/decl.ts'
import { POOL_LANES, POOL_SORT_BOUND, POOL_SORT_TOTAL } from './sortWords.ts'

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

/** The boundary's and the total's words as the kernels name them. */
export const POOL_SORT_HEAD_WGSL = wgslBlock(
  'POOL_SORT_HEAD_WGSL',
  [],
  wgslConsts({ POOL_BOUND: POOL_SORT_BOUND, POOL_TOTAL: POOL_SORT_TOTAL }),
)

/** `POOL_LANES` as the kernels name it: the host's workgroup count and the kernels' width are one
 *  number. */
export const POOL_LANES_WGSL = wgslConst('POOL_LANES', [], wgslConsts({ POOL_LANES }))

/**
 * A pool's victim queue on `pass`, its bind group already set, each stage's pipeline read off
 * `pipelineOf`: over the `slots` the pool may hold — those past its count leave at once —, the
 * stages a group of slots runs in rows of `width` workgroups, the others in one workgroup. With
 * `args`, the group stages dispatch from its record at `offset`, armed for the pool's own count
 * (`../dag/poolList.ts`, `poolSortArming`): no workgroup past it.
 */
export function encodePoolSort(
  pass: GPUComputePassEncoder,
  pipelineOf: (stage: PoolSortStage) => GPUComputePipeline,
  slots: number,
  width: number,
  args?: GPUBuffer,
  offset = 0,
) {
  const groups = workgroupCount(slots, POOL_LANES)
  for (const stage of POOL_SORT_STAGES) {
    pass.setPipeline(pipelineOf(stage))
    if (ONE_WORKGROUP.has(stage)) pass.dispatchWorkgroups(1)
    else if (args) pass.dispatchWorkgroupsIndirect(args, offset)
    else dispatchRows(pass, groups, 1, width)
  }
}
