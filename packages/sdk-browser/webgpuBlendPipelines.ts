import { BLEND_SHADER } from './webgpuBlendShader.ts';
import { FEEDBACK_FORMAT } from './surfaceBuffer.ts';
import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { BLEND_BINDINGS, atlasLayoutEntries, readOnly } from './webgpuBindLayout.ts';
import { WATER_SURFACE_WGSL } from './webgpuWaterSurfaceWgsl.ts';
import { createWaterPass } from './webgpuWaterPass.ts';
import {
  blendVariantPipeline,
  DIAGNOSTIC_BLEND_WGSL,
  type DiagnosticGpuVariant,
} from './diagnosticGpuVariant.ts';
import { DEPTH_COMPARE } from './depthConvention.ts';

/** Builds the forward-material pipelines for transparent draws, and the water pass of a scene
 *  that transmits. */
export async function createWebgpuBlendPipelines(
  device: GPUDevice,
  items: BlendGpuItem[],
  variant?: DiagnosticGpuVariant,
) {
  const b = BLEND_BINDINGS;
  // Without a variant, the module and the targets are exactly those of before: production compiles
  // no diagnostic stage and has no write mask of its own.
  const { entryPoint, writeMask } = blendVariantPipeline(variant);
  const blendBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.positions, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.uvs, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      {
        binding: b.uniform,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: BLEND_VIEW_SIZE },
      },
      // Each item's record, read at the rank the vertex index carries: it is what replaces the
      // dynamic uniform offset, and therefore the bind group per draw.
      { binding: b.items, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      ...atlasLayoutEntries(b.color),
      { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ...atlasLayoutEntries(b.data),
      { binding: b.normals, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.directLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.clusterDiagnostic, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.planInstances, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.clusterSpans, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.shadowSlices, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      {
        binding: b.shadowAtlas,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth' },
      },
      {
        binding: b.shadowSampler,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'comparison' },
      },
      { binding: b.bounceGrid, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: b.probes, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.tileLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      // Resident proxy of the far sun shadow: **read-only**, and that is the condition of early
      // depth rejection for the whole pass. A binding writable from the fragment stage forces the
      // GPU to shade every fragment before testing it, side effect and all — here 4232 fragment
      // draws fully hidden behind opaque. The shadow ray is the same; only the two census counters
      // stay with deferred resolve, which can write. It is the eighth and last storage binding of
      // this fragment stage, the one the spec still guarantees.
      { binding: b.proxy, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
    ],
  });
  // The water surface stage is compiled only for a scene that transmits: the others run exactly
  // the previous module.
  const transmissive = items.some((item) => item.transmissive);
  const blendModule = device.createShaderModule({
    code:
      BLEND_SHADER +
      (transmissive ? WATER_SURFACE_WGSL : '') +
      (variant ? DIAGNOSTIC_BLEND_WGSL : ''),
  });
  const makeBlend = (cullMode: GPUCullMode) => {
    const descriptor: GPURenderPipelineDescriptor = {
      layout: device.createPipelineLayout({ bindGroupLayouts: [blendBindGroupLayout] }),
      vertex: { module: blendModule, entryPoint: 'vs' },
      fragment: {
        module: blendModule,
        entryPoint,
        targets: [
          {
            format: 'rgba16float' as GPUTextureFormat,
            writeMask,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
          // Tile rank the pixel requests from the virtual textures: an integer target, without blend,
          // that reduction rereads after the pass.
          { format: FEEDBACK_FORMAT },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: false,
        depthCompare: DEPTH_COMPARE,
      },
    };
    return device.createRenderPipelineAsync
      ? device.createRenderPipelineAsync(descriptor)
      : Promise.resolve(device.createRenderPipeline(descriptor));
  };
  for (const item of items) item.group = undefined;
  const pipelineBlendTextured = await makeBlend('none'),
    pipelineBlendFront = await makeBlend('front'),
    pipelineBlendBack = await makeBlend('back');
  // The water pass shares the module and the layout: under a diagnostic variant the transmission
  // slice draws as one more blend, so the variant measures the same fragment stage on all of it.
  const water =
    transmissive && !variant
      ? await createWaterPass(device, blendModule, blendBindGroupLayout, items.length)
      : undefined;
  return {
    blendBindGroupLayout,
    pipelineBlendTextured,
    pipelineBlendFront,
    pipelineBlendBack,
    water,
  };
}
