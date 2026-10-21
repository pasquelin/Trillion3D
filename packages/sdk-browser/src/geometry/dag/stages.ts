import { LEVEL_QUEUES } from './shader/levelWgsl.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import type { CutSteps } from './cut/cutSteps.ts'
import { DIFFERENCE_STAGES, KEEP_STAGES, REKEEP_STAGES } from './shader/differenceWgsl.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'
import { buildDagArm, type DagArmWords } from './arm.ts'

/** The stages that read the pyramid (`shader/occlusionWgsl.ts`): the descent's levels, the
 *  clusters' tests and the post pass's retests, on the cut's group and the occlusion's. */
const levels = Array.from({ length: LEVEL_QUEUES }, (_, q) => `dagLevel${q}`)
const SIGHTED = [...levels, 'dagWanted', 'dagPostNodes', 'dagPostClusters'] as const
/** The others, on the cut's group alone. */
const PLAIN = [
  'dagPrepare',
  'dagClearDrawn',
  'dagMask',
  'dagDrawPrefix',
  'dagCommitMask',
  'dagDrawScatter',
  'dagPostPrepare',
  ...DIFFERENCE_STAGES,
  ...KEEP_STAGES,
  ...REKEEP_STAGES,
  'dagRestoreJournal',
] as const

/** Every selection stage of `module`: those that read the pyramid on `layout` and `occlusion`, the
 *  others on `layout` alone, and its arming kernel on `arm.layout` at the list words `arm.words`
 *  (`arm.ts`); a device whose dispatch width is not WebGPU's default sets its own (`GROUP_WIDTH`,
 *  `../../gpu/dispatch/grid.ts`). The real-GPU compile probe builds exactly these
 *  (`tests/gpu/dag/kernels-compile.gpu.ts`). All are asked together and compile off the thread:
 *  none waits behind a compile asked after them. */
export async function createDagStages(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  occlusion: GPUBindGroupLayout,
  module: GPUShaderModule,
  arm: { layout: GPUBindGroupLayout; words: DagArmWords },
  steps?: CutSteps,
) {
  const constants = groupWidthConstants(groupWidth(device.limits))
  const total = SIGHTED.length + PLAIN.length
  // What each pipeline handed back tells, and those still asked: a compile that never answers is
  // named by the opening that waits on it.
  const waiting = new Set<string>([...SIGHTED, ...PLAIN])
  const handed = (entry: string, ms: number) => {
    waiting.delete(entry)
    const rest = waiting.size ? `; waiting on ${[...waiting].join(' ')}` : ''
    steps?.note(`${total - waiting.size}/${total}, ${entry} after ${Math.round(ms)} ms${rest}`)
  }
  const [sighted, stage, armPipeline] = await Promise.all([
    buildComputeStages(device, [layout, occlusion], module, SIGHTED, constants, handed),
    buildComputeStages(device, [layout], module, PLAIN, constants, handed),
    buildDagArm(device, module, arm.layout, arm.words),
  ])
  const levelPipelines = levels.map((level) => sighted[level])
  return {
    preparePipeline: stage.dagPrepare,
    clearDrawnPipeline: stage.dagClearDrawn,
    levelPipelines,
    wantedPipeline: sighted.dagWanted,
    maskPipeline: stage.dagMask,
    drawPrefixPipeline: stage.dagDrawPrefix,
    drawScatterPipeline: stage.dagDrawScatter,
    /** The cut's mask and drawn log made the frame's, when no work was dropped. */
    commitPipeline: stage.dagCommitMask,
    /** The post pass: its opening, its held items' and clusters' retests (`shader/postPassWgsl.ts`). */
    postPreparePipeline: stage.dagPostPrepare,
    postNodesPipeline: sighted.dagPostNodes,
    postClustersPipeline: sighted.dagPostClusters,
    /** Each kept list's difference, then its keep (`shader/differenceWgsl.ts`). */
    differencePipelines: DIFFERENCE_STAGES.map((name) => stage[name]),
    keepPipelines: KEEP_STAGES.map((name) => stage[name]),
    /** Each kept list ranked in a readout made again (`lists/listGrowth.ts`). */
    rekeepPipelines: REKEEP_STAGES.map((name) => stage[name]),
    /** A view's saved journal written back with its draw flags (`shader/swapWgsl.ts`). */
    restorePipeline: stage.dagRestoreJournal,
    /** Every list's indirect arguments armed in the pass (`shader/armWgsl.ts`). */
    armPipeline,
  }
}
