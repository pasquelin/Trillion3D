import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
import { withScreenErrorVariant } from './gpuDagShaderError.ts';
import { screenErrorVariant } from '../sdk-core/index.ts';
import { openValidation, validationError } from './gpuErrorScope.ts';
import { shaderFailed } from './gpuShaderModule.ts';

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

export async function createDagPipeline(device: GPUDevice, buffers: DagBuffers) {
  const { clusters, nodes, uniforms, flags, output, work, worlds, frames, pageCones } = buffers;
  openValidation(device);
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
  // La variante d'erreur écran est figée à la compilation du nuanceur : elle ne change plus de
  // l'ouverture de la session à sa fermeture, et le texte par défaut est rendu caractère pour
  // caractère (`withScreenErrorVariant`).
  const module = device.createShaderModule({
    code: withScreenErrorVariant(DAG_SELECTION_SHADER, screenErrorVariant()),
  });
  if (await shaderFailed(device, module)) return undefined;
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const stage = (entryPoint: string) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
  const preparePipeline = stage('dagPrepare'),
    clearDrawnPipeline = stage('dagClearDrawn');
  const levelPipelines = [stage('dagLevel0'), stage('dagLevel1')];
  const wantedPipeline = stage('dagWanted'),
    escalatePipeline = stage('dagEscalate'),
    checkPipeline = stage('dagCheck'),
    maskPipeline = stage('dagMask');
  const drawPrefixPipeline = stage('dagDrawPrefix'),
    drawScatterPipeline = stage('dagDrawScatter');
  if (await validationError(device)) return undefined;
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
    preparePipeline,
    clearDrawnPipeline,
    levelPipelines,
    wantedPipeline,
    escalatePipeline,
    checkPipeline,
    maskPipeline,
    drawPrefixPipeline,
    drawScatterPipeline,
    bindGroup,
  };
}
