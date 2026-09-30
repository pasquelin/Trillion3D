import { DISPLAY_FORMAT } from '../../scene/surfaceBuffer.ts';
import { ADD_EQUATIONS, TINT_EQUATIONS } from './equations.ts';
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts';
import { DISPLAY_FILTER_SHADER } from './displayFilterWgsl.ts';

/** The program of one device, made by its first image with display layers, kept across sizes. */
function createProgram(device: GPUDevice) {
  const module = device.createShaderModule({ label: 'DISPLAY', code: DISPLAY_FILTER_SHADER });
  const texture = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'float' },
  });
  const sampler = { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} };
  const drawn = { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: {} };
  const layout = device.createBindGroupLayout({
    entries: [texture(0), texture(1), sampler, drawn],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  // The display value times the tint, then plus the added value, as the witness's canvas blends.
  const pipeline = (entryPoint: string, blend: GPUBlendState, formats: GPUTextureFormat[]) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'screen' },
      fragment: { module, entryPoint, targets: formats.map((format) => ({ format, blend })) },
      primitive: { topology: 'triangle-list' },
    });
  const both: GPUTextureFormat[] = [DISPLAY_FORMAT, 'bgra8unorm'];
  const [tint, add] = [TINT_EQUATIONS.multiply!, ADD_EQUATIONS.additive!];
  return {
    layout,
    sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
    mask: device.createBindGroupLayout({ entries: [texture(0)] }),
    draw: [pipeline('tint', tint, [DISPLAY_FORMAT]), pipeline('add', add, [DISPLAY_FORMAT])],
    present: [pipeline('tint', tint, both), pipeline('add', add, both)],
  };
}

export const programOf = oncePerDevice(createProgram);
