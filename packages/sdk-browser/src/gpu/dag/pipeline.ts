import { DAG_SELECTION_SHADER } from './shader/shader.ts';
import { dagBindEntries, type dagGroupEntries } from './shader/bindings.ts';
import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { withScreenErrorVariant } from './shader/error.ts';
import { screenErrorVariant } from '../../../../sdk-core/src/index.ts';
import { validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import type { CameraFrames } from './frameRanges.ts';

/** The selection stages, and one bind group per range of `frames` with its primitive count, under
 *  one validation scope. A split table's stages are its own (`SPLIT`, `shader/viewsWgsl.ts`). */
export function createDagPipeline(
  device: GPUDevice,
  buffers: Omit<Parameters<typeof dagGroupEntries>[0], 'frames'>,
  frames: CameraFrames,
) {
  const constants = frames.ranges.length > 1 ? { SPLIT: 1 } : undefined;
  return validated(device, async () => {
    const layout = device.createBindGroupLayout({ entries: dagBindEntries() });
    // The screen-error variant is frozen at shader compile: it no longer changes from
    // session open to session close, and the default text is rendered character for
    // character (`withScreenErrorVariant`).
    const module = device.createShaderModule({
      code: withScreenErrorVariant(DAG_SELECTION_SHADER, screenErrorVariant()),
    });
    if (await shaderFailed(module)) return undefined;
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const stage = (entryPoint: string) =>
      device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint, ...(constants && { constants }) },
      });
    const preparePipeline = stage('dagPrepare'),
      clearDrawnPipeline = stage('dagClearDrawn');
    const levelPipelines = Array.from({ length: LEVEL_QUEUES }, (_, q) => stage(`dagLevel${q}`));
    // One range: pass 0 reads the whole queue 0, `dagLevel0` itself.
    const rootLevelPipeline = constants ? stage('dagRootLevel') : levelPipelines[0];
    const wantedPipeline = stage('dagWanted'),
      maskPipeline = stage('dagMask');
    const drawPrefixPipeline = stage('dagDrawPrefix'),
      drawScatterPipeline = stage('dagDrawScatter'),
      viewOffsetsPipeline = stage('dagViewOffsets'),
      requestSortPipeline = stage('dagSortRequests'),
      evictPipeline = stage('dagListEvictions');
    const ranges = frames.bindGroups(layout, buffers);
    return {
      /** Bind layout, returned with the stages: the dispatch bench mounts the previous
       *  cut on EXACTLY this one, instead of retyping a fourth copy. */
      layout,
      preparePipeline,
      clearDrawnPipeline,
      rootLevelPipeline,
      levelPipelines,
      wantedPipeline,
      maskPipeline,
      drawPrefixPipeline,
      drawScatterPipeline,
      viewOffsetsPipeline,
      requestSortPipeline,
      evictPipeline,
      ranges,
    };
  });
}
