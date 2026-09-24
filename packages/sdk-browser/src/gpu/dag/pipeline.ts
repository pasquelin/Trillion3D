import { DAG_SELECTION_SHADER } from './shader/shader.ts';
import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { withScreenErrorVariant } from './shader/error.ts';
import { screenErrorVariant } from '../../../../sdk-core/src/index.ts';
import { validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';

type DagBuffers = {
  clusters: GPUBuffer;
  nodes: GPUBuffer;
  uniforms: GPUBuffer;
  flags: GPUBuffer;
  output: GPUBuffer;
  work: GPUBuffer;
  worlds: GPUBuffer;
  frames: GPUBuffer;
  pageCones: GPUBuffer;
};

/** The selection stages and their bind group, under one validation scope. */
export function createDagPipeline(device: GPUDevice, buffers: DagBuffers) {
  const { clusters, nodes, uniforms, flags, output, work, worlds, frames, pageCones } = buffers;
  return validated(device, async () => {
    const storage = { type: 'storage' } as const,
      readOnly = { type: 'read-only-storage' } as const;
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: readOnly },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: readOnly },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: storage },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: storage },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: storage },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: readOnly },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: storage },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: readOnly },
      ],
    });
    // The screen-error variant is frozen at shader compile: it no longer changes from
    // session open to session close, and the default text is rendered character for
    // character (`withScreenErrorVariant`).
    const module = device.createShaderModule({
      code: withScreenErrorVariant(DAG_SELECTION_SHADER, screenErrorVariant()),
    });
    if (await shaderFailed(module)) return undefined;
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const stage = (entryPoint: string) =>
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
    const preparePipeline = stage('dagPrepare'),
      clearDrawnPipeline = stage('dagClearDrawn');
    const levelPipelines = Array.from({ length: LEVEL_QUEUES }, (_, q) => stage(`dagLevel${q}`));
    const wantedPipeline = stage('dagWanted'),
      escalatePipeline = stage('dagEscalate'),
      checkPipeline = stage('dagCheck'),
      maskPipeline = stage('dagMask');
    const drawPrefixPipeline = stage('dagDrawPrefix'),
      drawScatterPipeline = stage('dagDrawScatter'),
      viewOffsetsPipeline = stage('dagViewOffsets');
    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: clusters } },
        { binding: 1, resource: { buffer: nodes } },
        { binding: 2, resource: { buffer: uniforms } },
        { binding: 3, resource: { buffer: flags } },
        { binding: 4, resource: { buffer: output } },
        { binding: 5, resource: { buffer: work } },
        { binding: 6, resource: { buffer: worlds } },
        { binding: 7, resource: { buffer: frames } },
        { binding: 8, resource: { buffer: pageCones } },
      ],
    });
    return {
      /** Bind layout, returned with the stages: the dispatch bench mounts the previous
       *  cut on EXACTLY this one, instead of retyping a fourth copy. */
      layout,
      preparePipeline,
      clearDrawnPipeline,
      levelPipelines,
      wantedPipeline,
      escalatePipeline,
      checkPipeline,
      maskPipeline,
      drawPrefixPipeline,
      drawScatterPipeline,
      viewOffsetsPipeline,
      bindGroup,
    };
  });
}
