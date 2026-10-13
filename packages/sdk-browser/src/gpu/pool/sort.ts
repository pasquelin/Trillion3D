import { dispatchRows } from '../dispatch/grid.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { POOL_RANKS } from './rank.ts'

/** The three entry points of a pool's victim queue (`sortWgsl.ts`), in their order. */
export const POOL_SORT_STAGES = ['poolCount', 'poolPlace', 'poolScatter'] as const

/** The atomic words a pool's sort counts and places in: `POOL_RANKS` counts, then as many places. */
export const POOL_SORT_WORDS = 2 * POOL_RANKS

/** Lanes of a counting or scattering workgroup: one slot each (`POOL_LANES`, `sortWgsl.ts`). */
const POOL_LANES = 256

/** The pipelines of `POOL_SORT_STAGES`, built from the module that holds `POOL_SORT_WGSL`. */
export type PoolSortPipelines = {
  count: GPUComputePipeline
  place: GPUComputePipeline
  scatter: GPUComputePipeline
}

/** The three pipelines of a pool's sort out of a stage table built on `POOL_SORT_STAGES`. */
export const poolSortPipelines = (
  stage: Record<(typeof POOL_SORT_STAGES)[number], GPUComputePipeline>,
): PoolSortPipelines => ({
  count: stage.poolCount,
  place: stage.poolPlace,
  scatter: stage.poolScatter,
})

/**
 * A pool's victim queue on `pass`, its bind group already set: a thread a slot of the `slots` the
 * pool may hold — those past its count leave at once —, in rows of `width` workgroups, then one
 * thread, then a thread a slot again.
 */
export function encodePoolSort(
  pass: GPUComputePassEncoder,
  { count, place, scatter }: PoolSortPipelines,
  slots: number,
  width: number,
) {
  const groups = workgroupCount(slots, POOL_LANES)
  pass.setPipeline(count)
  dispatchRows(pass, groups, 1, width)
  pass.setPipeline(place)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(scatter)
  dispatchRows(pass, groups, 1, width)
}
