import { FEEDBACK_FORMAT, SURFACE_FORMATS } from './surfaceBuffer.ts';
import { SHADE_UNIFORM_BYTES } from './visibilityShaderRequest.ts';
import { depthLayerUnits } from '../sdk-core/index.ts';
import { DEPTH_COMPARE } from './depthConvention.ts';
import { openValidation, validationError } from './gpuErrorScope.ts';
import { SHADE_BINDINGS, atlasLayoutEntries, readOnly } from './webgpuBindLayout.ts';
import { shadeVariantFragment, visVariantFragment } from './diagnosticGpuGeometry.ts';
import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';

/** Face modes of a layer set, in order: back, none, front, reversed back, reversed front. */
const LAYER_CULLS: Array<[GPUCullMode, GPUFrontFace]> = [
  ['back', 'ccw'],
  ['none', 'ccw'],
  ['front', 'ccw'],
  ['back', 'cw'],
  ['front', 'cw'],
];
const VIS_LAYER_CULLS = LAYER_CULLS.length;
/** Pipelines of a layer: the five face modes as occluder, then the same as tested. */
const VIS_LAYER_PIPELINES = VIS_LAYER_CULLS * 2;
/** Rank of a layer pipeline in `visLayerPipelines`. Layer 0 is not in it. */
export const visLayerPipelineIndex = (layer: number, rest: boolean, cull: number) =>
  (layer - 1) * VIS_LAYER_PIPELINES + (rest ? VIS_LAYER_CULLS : 0) + cull;

/** Creates under a validation scope, and lets through what the device refused. */
async function scoped<T>(device: GPUDevice, run: () => T): Promise<T> {
  openValidation(device);
  const value = run();
  const error = await validationError(device);
  if (error) throw error;
  return value;
}

/** Builds the visibility variants used by the selected Hi-Z or fallback path. */
export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
  variant?: DiagnosticGpuVariant,
) {
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const depth: GPUDepthStencilState = {
    format: 'depth32float',
    depthWriteEnabled: true,
    depthCompare: DEPTH_COMPARE,
  };
  const targets: GPUColorTargetState[] = hiz
    ? [{ format: 'r32uint' }, { format: 'r32float' }]
    : [{ format: 'r32uint' }];
  const make = (
    vertex: string,
    fragment: string,
    cullMode: GPUCullMode,
    frontFace: GPUFrontFace = 'ccw',
  ) =>
    device.createRenderPipeline({
      layout,
      vertex: { module: visModule, entryPoint: vertex },
      fragment: { module: visModule, entryPoint: fragment, targets },
      primitive: { topology: 'triangle-list', cullMode, frontFace },
      depthStencil: depth,
    });
  return scoped(device, () => {
    const fragment = visVariantFragment(hiz, variant);
    return {
      visPipelineBack: make('vis_vs', fragment, 'back'),
      visPipelineBackCw: make('vis_vs', fragment, 'back', 'cw'),
      visPipelineNone: make('vis_vs', fragment, 'none'),
      visPipelineFront: make('vis_vs', fragment, 'front'),
      visPipelineFrontCw: make('vis_vs', fragment, 'front', 'cw'),
      visHizRestBack: hiz ? make('vis_hiz_vs', fragment, 'back') : undefined,
      visHizRestNone: hiz ? make('vis_hiz_vs', fragment, 'none') : undefined,
      visHizRestFront: hiz ? make('vis_hiz_vs', fragment, 'front') : undefined,
    };
  });
}

/**
 * Pipelines of the coplanar layers above 0. A layer is only an integer depth bias on the same
 * pipeline: same module, same state, same draw order. Targets and inputs follow those layer 0 kept,
 * Hi-Z included, so both passes write the same attachments. `layerSlots` of 1 creates nothing.
 */
export function createWebgpuCoplanarLayerPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
  layerSlots: number,
  variant?: DiagnosticGpuVariant,
) {
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const targets: GPUColorTargetState[] = hiz
    ? [{ format: 'r32uint' }, { format: 'r32float' }]
    : [{ format: 'r32uint' }];
  const fragment = visVariantFragment(hiz, variant);
  return scoped(device, () => {
    const pipelines: GPURenderPipeline[] = [];
    for (let layer = 1; layer < layerSlots; layer++)
      for (const rest of [false, true])
        for (const [cullMode, frontFace] of LAYER_CULLS)
          pipelines.push(
            device.createRenderPipeline({
              layout,
              vertex: { module: visModule, entryPoint: rest && hiz ? 'vis_hiz_vs' : 'vis_vs' },
              fragment: { module: visModule, entryPoint: fragment, targets },
              primitive: { topology: 'triangle-list', cullMode, frontFace },
              depthStencil: {
                format: 'depth32float',
                depthWriteEnabled: true,
                depthCompare: DEPTH_COMPARE,
                // Reversed depth: moving closer to the eye ADDS units.
                depthBias: depthLayerUnits(layer),
              },
            }),
          );
    return pipelines;
  });
}

/** Builds the material resolve pipeline after shader compilation succeeds. */
export function createWebgpuShadePipeline(
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  variant?: DiagnosticGpuVariant,
) {
  const b = SHADE_BINDINGS;
  const fragment = GPUShaderStage.FRAGMENT;
  const shadeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.visView, visibility: fragment, texture: { sampleType: 'uint' } },
      { binding: b.cache, visibility: fragment, buffer: readOnly },
      { binding: b.position, visibility: fragment, buffer: readOnly },
      { binding: b.uv, visibility: fragment, buffer: readOnly },
      { binding: b.normal, visibility: fragment, buffer: readOnly },
      { binding: b.pageTable, visibility: fragment, buffer: readOnly },
      ...atlasLayoutEntries(b.color),
      { binding: b.sampler, visibility: fragment, sampler: { type: 'filtering' } },
      {
        binding: b.uniform,
        visibility: fragment,
        buffer: { type: 'uniform', minBindingSize: SHADE_UNIFORM_BYTES },
      },
      ...atlasLayoutEntries(b.data),
    ],
  });
  return scoped(device, () => ({
    shadeBindGroupLayout,
    shadePipeline: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [shadeBindGroupLayout] }),
      vertex: { module: shadeModule, entryPoint: 'shade_vs' },
      fragment: {
        module: shadeModule,
        entryPoint: shadeVariantFragment(variant),
        // The surfaces, then the tile request the image's feedback target receives.
        targets: [...SURFACE_FORMATS, FEEDBACK_FORMAT].map((format) => ({ format })),
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  }));
}
