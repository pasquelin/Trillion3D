import { FEEDBACK_FORMAT, SURFACE_FORMATS } from './surfaceBuffer.ts';
import { DEPTH_COMPARE } from './depthConvention.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';
import {
  WATER_BINDINGS,
  WATER_COMPOSITE_SHADER,
  WATER_VIEW_SIZE,
} from './webgpuWaterCompositeWgsl.ts';

/** Builds a pipeline, asynchronously when the device offers it. */
const build = (device: GPUDevice, descriptor: GPURenderPipelineDescriptor) =>
  device.createRenderPipelineAsync
    ? device.createRenderPipelineAsync(descriptor)
    : Promise.resolve(device.createRenderPipeline(descriptor));

/** Surface pipelines of the water pass, at the three cull modes of the blend plan
 *  (`webgpuBlendPlan.ts`): none, front, back — the same rank picks the same side. */
export type WaterSurfacePipelines = [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];

/**
 * Surface stage: the blend module's vertex stage and `fsWater`, on the blend bind group layout —
 * nothing else is bound for it. Depth is tested AND written, against the opaque depth copied in:
 * the nearest surface of a pixel is the one the composite lights, and a surface behind an opaque
 * never reaches it. No blend: the targets carry material values, not colour.
 */
export function createWaterSurfacePipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
): Promise<WaterSurfacePipelines> {
  const make = (cullMode: GPUCullMode) => {
    const descriptor: GPURenderPipelineDescriptor = {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fsWater',
        targets: [...SURFACE_FORMATS.map((format) => ({ format })), { format: FEEDBACK_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: DEPTH_COMPARE,
      },
    };
    return build(device, descriptor);
  };
  return Promise.all([make('none'), make('front'), make('back')]);
}

const readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' };

/** Layout of the composite: what `WATER_COMPOSITE_SHADER` declares, binding by binding. */
export function createWaterCompositeLayout(device: GPUDevice) {
  const b = WATER_BINDINGS,
    fragment = GPUShaderStage.FRAGMENT;
  const texture = (binding: number, sampleType: GPUTextureSampleType) => ({
    binding,
    visibility: fragment,
    texture: { sampleType },
  });
  return device.createBindGroupLayout({
    label: 'WG water composite',
    entries: [
      texture(b.baseMetal, 'unfilterable-float'),
      texture(b.normalRough, 'unfilterable-float'),
      texture(b.emissiveAo, 'unfilterable-float'),
      texture(b.flags, 'uint'),
      texture(b.depth, 'depth'),
      texture(b.backdrop, 'unfilterable-float'),
      texture(b.backdropDepth, 'depth'),
      { binding: b.uniform, visibility: fragment, buffer: { type: 'uniform' } },
      {
        binding: b.view,
        visibility: fragment,
        buffer: { type: 'uniform', minBindingSize: WATER_VIEW_SIZE },
      },
      { binding: b.volumes, visibility: fragment, buffer: readOnly },
      { binding: b.directLights, visibility: fragment, buffer: readOnly },
      { binding: b.tileLights, visibility: fragment, buffer: readOnly },
      { binding: b.shadowSlices, visibility: fragment, buffer: readOnly },
      texture(b.shadowAtlas, 'depth'),
      { binding: b.shadowSampler, visibility: fragment, sampler: { type: 'comparison' } },
      { binding: b.bounceGrid, visibility: fragment, buffer: { type: 'uniform' } },
      { binding: b.probes, visibility: fragment, buffer: readOnly },
      { binding: b.proxy, visibility: fragment, buffer: readOnly },
    ],
  });
}

/**
 * Composite pipeline: a fullscreen triangle into the HDR target, blended exactly as the forward
 * transmission pass was — source alpha over what the frame already holds, which at a water pixel is
 * the frozen backdrop itself. A pixel with no water discards, and the target keeps its value.
 */
export async function createWaterCompositePipeline(device: GPUDevice, layout: GPUBindGroupLayout) {
  const module = await createCheckedShaderModule(device, WATER_COMPOSITE_SHADER, 'WATER_COMPOSITE');
  const descriptor: GPURenderPipelineDescriptor = {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: {
      module,
      entryPoint: 'composeWater',
      targets: [
        {
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  };
  return build(device, descriptor);
}
