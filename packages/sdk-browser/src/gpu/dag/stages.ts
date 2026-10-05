import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { DEFAULT_GROUP_WIDTH, groupWidth } from './shader/gridWgsl.ts';
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts';

/** Every selection stage of `module` on `layout`; a split table's stages are its own (`SPLIT`,
 *  `shader/viewsWgsl.ts`), and a device whose dispatch width is not WebGPU's default sets its own
 *  (`GROUP_WIDTH`, `shader/gridWgsl.ts`). The real-GPU compile probe builds exactly these
 *  (`tests/gpu/dag/kernels-compile.gpu.ts`). All compile together, off the thread. */
export async function createDagStages(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  module: GPUShaderModule,
  split: boolean,
) {
  const width = groupWidth(device.limits);
  const set = {
    ...(split && { SPLIT: 1 }),
    ...(width !== DEFAULT_GROUP_WIDTH && { GROUP_WIDTH: width }),
  };
  const constants = Object.keys(set).length ? set : undefined;
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const levels = Array.from({ length: LEVEL_QUEUES }, (_, q) => `dagLevel${q}`);
  const stage = await buildComputeStages(
    device,
    pipelineLayout,
    module,
    [
      ...levels,
      ...(split ? ['dagRootLevel'] : []),
      'dagPrepare',
      'dagClearDrawn',
      'dagWanted',
      'dagMask',
      'dagDrawPrefix',
      'dagDrawScatter',
      'dagSortRequests',
      'dagListEvictions',
      'dagCutDifference',
      'dagCutKeep',
    ],
    constants,
  );
  const levelPipelines = levels.map((level) => stage[level]);
  return {
    preparePipeline: stage.dagPrepare,
    clearDrawnPipeline: stage.dagClearDrawn,
    // One range: pass 0 reads the whole queue 0, `dagLevel0` itself.
    rootLevelPipeline: split ? stage.dagRootLevel : levelPipelines[0],
    levelPipelines,
    wantedPipeline: stage.dagWanted,
    maskPipeline: stage.dagMask,
    drawPrefixPipeline: stage.dagDrawPrefix,
    drawScatterPipeline: stage.dagDrawScatter,
    requestSortPipeline: stage.dagSortRequests,
    evictPipeline: stage.dagListEvictions,
    differencePipeline: stage.dagCutDifference,
    keepPipeline: stage.dagCutKeep,
  };
}
