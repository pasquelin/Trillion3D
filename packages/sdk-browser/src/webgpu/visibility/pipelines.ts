import { FEEDBACK_FORMAT, SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts';
import { SHADE_UNIFORM_BYTES } from '../../visibility/shader/request.ts';
import { depthLayerUnits } from '../../../../sdk-core/src/index.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { openValidation, validationError } from '../../gpu/core/errorScope.ts';
import { SHADE_BINDINGS, atlasLayoutEntries, readOnly } from '../core/bindLayout.ts';
import { shadeVariantFragment, visVariantFragment } from '../../diagnostic/gpuGeometry.ts';
import { MATERIAL_DEPTH_FORMAT } from '../../visibility/shader/materialClass.ts';
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts';

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

/**
 * Builds the material resolve after shader compilation succeeds: the material-depth export, then
 * one pipeline per class of the scene, each compiled with the class's overrides and drawn under
 * the depth test equal to its class depth (`../../visibility/shader/materialClass.ts`). Compiled here, at
 * preparation: no image pays the first draw of a class.
 */
export function createWebgpuShadePipelines(
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  classes: readonly number[],
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
  const layout = device.createPipelineLayout({ bindGroupLayouts: [shadeBindGroupLayout] });
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
  const entryPoint = shadeVariantFragment(variant);
  /** A class pipeline: the class key as override of both stages, whatever the fragment reads;
   *  the depth and the feature booleans derive from it in the shader. */
  const shadePipelineFor = (key: number) => {
    const constants = { CLASS_KEY: key };
    return device.createRenderPipeline({
      layout,
      vertex: { module: shadeModule, entryPoint: 'shade_vs', constants },
      fragment: {
        module: shadeModule,
        entryPoint,
        constants,
        // The surfaces, then the tile request the image's feedback target receives.
        targets: [...SURFACE_FORMATS, FEEDBACK_FORMAT].map((format) => ({ format })),
      },
      primitive,
      depthStencil: {
        format: MATERIAL_DEPTH_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'equal',
      },
    });
  };
  return scoped(device, () => ({
    shadeBindGroupLayout,
    materialDepthPipeline: device.createRenderPipeline({
      layout,
      vertex: { module: shadeModule, entryPoint: 'shade_vs' },
      fragment: { module: shadeModule, entryPoint: 'material_depth_fs', targets: [] },
      primitive,
      depthStencil: {
        format: MATERIAL_DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'always',
      },
    }),
    shadePipelineFor,
    shadePipelines: new Map(classes.map((key) => [key, shadePipelineFor(key)])),
  }));
}
