import { dagSelectionShader } from './shader/splitWgsl.ts';
import { dagPartCounts, type DagSplit } from './split.ts';
import { dagBindEntries, type dagGroupEntries } from './shader/bindings.ts';
import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { withScreenErrorVariant } from './shader/error.ts';
import { screenErrorVariant } from '../../../../sdk-core/src/index.ts';
import { validated } from '../core/errorScope.ts';
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import type { CameraFrames } from './frameRanges.ts';
import { DEFAULT_GROUP_WIDTH, groupWidth } from './shader/gridWgsl.ts';

/** Every selection stage of `module` on `layout`; a split table's stages are its own (`SPLIT`,
 *  `shader/viewsWgsl.ts`), and a device whose dispatch width is not WebGPU's default sets its own
 *  (`GROUP_WIDTH`, `shader/gridWgsl.ts`). The real-GPU compile probe builds exactly these
 *  (`tests/browser/probes/dag-kernels-compile-gpu.ts`). All compile together, off the thread. */
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
      'dagViewOffsets',
      'dagSortRequests',
      'dagListEvictions',
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
    viewOffsetsPipeline: stage.dagViewOffsets,
    requestSortPipeline: stage.dagSortRequests,
    evictPipeline: stage.dagListEvictions,
  };
}

/** The selection stages, and one bind group per range of `frames` with its primitive count, under
 *  one validation scope. `split`, the tables in parts on this device (`split.ts`): the layout binds
 *  every part, and the text reads across them. */
export function createDagPipeline(
  device: GPUDevice,
  buffers: Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>,
  frames: CameraFrames,
  split?: DagSplit,
) {
  return validated(device, async () => {
    const layout = device.createBindGroupLayout({
      entries: dagBindEntries(split && dagPartCounts(split)),
    });
    // The screen-error variant is frozen at shader compile: it no longer changes from session
    // open to session close, and the default text is rendered character for character
    // (`withScreenErrorVariant`).
    const module = device.createShaderModule({
      code: withScreenErrorVariant(dagSelectionShader(split), screenErrorVariant()),
    });
    if (await shaderFailed(module)) return undefined;
    const stages = await createDagStages(device, layout, module, frames.ranges.length > 1);
    const ranges = frames.bindGroups(layout, buffers);
    return {
      /** Bind layout, returned with the stages: the dispatch bench mounts the previous cut on
       *  EXACTLY this one, instead of retyping a fourth copy. */
      layout,
      ...stages,
      ranges,
    };
  });
}
