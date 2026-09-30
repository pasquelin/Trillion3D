import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { DEFAULT_GROUP_WIDTH, groupWidth } from './shader/gridWgsl.ts';

/** Every selection stage of `module` on `layout`; a split table's stages are its own (`SPLIT`,
 *  `shader/viewsWgsl.ts`), and a device whose dispatch width is not WebGPU's default sets its own
 *  (`GROUP_WIDTH`, `shader/gridWgsl.ts`). The real-GPU compile probe builds exactly these
 *  (`tests/browser/probes/dag-kernels-compile-gpu.ts`). */
export function createDagStages(
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
  const stage = (entryPoint: string) =>
    device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint, ...(constants && { constants }) },
    });
  const levelPipelines = Array.from({ length: LEVEL_QUEUES }, (_, q) => stage(`dagLevel${q}`));
  return {
    preparePipeline: stage('dagPrepare'),
    clearDrawnPipeline: stage('dagClearDrawn'),
    // One range: pass 0 reads the whole queue 0, `dagLevel0` itself.
    rootLevelPipeline: split ? stage('dagRootLevel') : levelPipelines[0],
    levelPipelines,
    wantedPipeline: stage('dagWanted'),
    maskPipeline: stage('dagMask'),
    drawPrefixPipeline: stage('dagDrawPrefix'),
    drawScatterPipeline: stage('dagDrawScatter'),
    viewOffsetsPipeline: stage('dagViewOffsets'),
    requestSortPipeline: stage('dagSortRequests'),
    evictPipeline: stage('dagListEvictions'),
  };
}
