import { LEVEL_QUEUES } from './shader/levelWgsl.ts'
import { DEFAULT_GROUP_WIDTH, groupWidth } from '../dispatch/grid.ts'
import type { CutSteps } from './cutSteps.ts'
import { POOL_SORT_STAGES, type PoolSortStage } from '../pool/sort.ts'
import { DIFFERENCE_STAGES, KEEP_STAGES, REKEEP_STAGES } from './shader/differenceWgsl.ts'
import { buildComputeStages } from '../core/computeStages.ts'
import { buildDagArm, type DagArmWords } from './arm.ts'

/** Every selection stage of `module` on `layout`, and its arming kernel on `arm.layout` at the list
 *  words `arm.words` (`arm.ts`); a device whose dispatch width is not WebGPU's default sets its own
 *  (`GROUP_WIDTH`, `../dispatch/grid.ts`). The real-GPU compile probe builds exactly these
 *  (`tests/gpu/dag/kernels-compile.gpu.ts`). All are asked together and compile off the thread:
 *  none waits behind a compile asked after them. */
export async function createDagStages(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  module: GPUShaderModule,
  arm: { layout: GPUBindGroupLayout; words: DagArmWords },
  steps?: CutSteps,
) {
  const width = groupWidth(device.limits)
  const constants = width !== DEFAULT_GROUP_WIDTH ? { GROUP_WIDTH: width } : undefined
  const levels = Array.from({ length: LEVEL_QUEUES }, (_, q) => `dagLevel${q}`)
  const entries = [
    ...levels,
    'dagPrepare',
    'dagClearDrawn',
    'dagWanted',
    'dagMask',
    'dagDrawPrefix',
    'dagCommitMask',
    'dagDrawScatter',
    'dagSortRequests',
    'dagRaiseParents',
    ...POOL_SORT_STAGES,
    ...DIFFERENCE_STAGES,
    ...KEEP_STAGES,
    ...REKEEP_STAGES,
    'dagRestoreJournal',
  ] as const
  // What each pipeline handed back tells, and those still asked: a compile that never answers is
  // named by the opening that waits on it.
  const waiting = new Set<string>(entries)
  const [stage, armPipeline] = await Promise.all([
    buildComputeStages(device, [layout], module, entries, constants, (entry, ms) => {
      waiting.delete(entry)
      const rest = waiting.size ? `; waiting on ${[...waiting].join(' ')}` : ''
      const done = entries.length - waiting.size
      steps?.note(`${done}/${entries.length}, ${entry} after ${Math.round(ms)} ms${rest}`)
    }),
    buildDagArm(device, module, arm.layout, arm.words),
  ])
  const levelPipelines = levels.map((level) => stage[level])
  return {
    preparePipeline: stage.dagPrepare,
    clearDrawnPipeline: stage.dagClearDrawn,
    levelPipelines,
    wantedPipeline: stage.dagWanted,
    maskPipeline: stage.dagMask,
    drawPrefixPipeline: stage.dagDrawPrefix,
    drawScatterPipeline: stage.dagDrawScatter,
    /** The cut's mask and drawn log made the frame's, when no work was dropped. */
    commitPipeline: stage.dagCommitMask,
    requestSortPipeline: stage.dagSortRequests,
    /** The groups replacing the groups the cut raised, raised with them (`shader/lastUseWgsl.ts`). */
    raisePipeline: stage.dagRaiseParents,
    /** The eviction queue: the pool's sort (`shader/evictWgsl.ts`). */
    evictSort: (name: PoolSortStage) => stage[name],
    /** Each kept list's difference, then its keep (`shader/differenceWgsl.ts`). */
    differencePipelines: DIFFERENCE_STAGES.map((name) => stage[name]),
    keepPipelines: KEEP_STAGES.map((name) => stage[name]),
    /** Each kept list ranked in a readout made again (`listGrowth.ts`). */
    rekeepPipelines: REKEEP_STAGES.map((name) => stage[name]),
    /** A view's saved journal written back with its draw flags (`shader/swapWgsl.ts`). */
    restorePipeline: stage.dagRestoreJournal,
    /** Every list's indirect arguments armed in the pass (`shader/armWgsl.ts`). */
    armPipeline,
  }
}
