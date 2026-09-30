import { shadeLayout } from './shadeLayout.ts';
import { depthLayerUnits } from '../../../../sdk-core/src/index.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { validationScope } from '../../gpu/core/errorScope.ts';
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts';
import {
  shadeVariantFragment,
  variesShade,
  visVariantFragment,
} from '../../diagnostic/gpuGeometry.ts';
import { MATERIAL_DEPTH_FORMAT } from '../../visibility/shader/materialClass.ts';
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts';
import { shadeTargetFormats } from './shadeTargets.ts';

const LAYER_CULLS: Array<[GPUCullMode, GPUFrontFace]> = [
  ['back', 'ccw'],
  ['none', 'ccw'],
  ['front', 'ccw'],
  ['back', 'cw'],
  ['front', 'cw'],
];
const VIS_LAYER_CULLS = LAYER_CULLS.length;
const VIS_LAYER_PIPELINES = VIS_LAYER_CULLS * 2;
export const visLayerPipelineIndex = (layer: number, rest: boolean, cull: number) =>
  (layer - 1) * VIS_LAYER_PIPELINES + (rest ? VIS_LAYER_CULLS : 0) + cull;
/** `run` under a validation scope; its pipelines compile off the thread, together (#1362). */
async function scoped<T>(device: GPUDevice, run: () => Promise<T>): Promise<T> {
  const { value, error } = await validationScope(device, run);
  if (error) throw error;
  return value;
}
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
    buildRenderPipeline(device, {
      layout,
      vertex: { module: visModule, entryPoint: vertex },
      fragment: { module: visModule, entryPoint: fragment, targets },
      primitive: { topology: 'triangle-list', cullMode, frontFace },
      depthStencil: depth,
    });
  return scoped(device, async () => {
    const fragment = visVariantFragment(hiz, variant);
    const rest = (cullMode: GPUCullMode) =>
      hiz ? make('vis_hiz_vs', fragment, cullMode) : Promise.resolve(undefined);
    const [back, backCw, none, front, frontCw, restBack, restNone, restFront] = await Promise.all([
      make('vis_vs', fragment, 'back'),
      make('vis_vs', fragment, 'back', 'cw'),
      make('vis_vs', fragment, 'none'),
      make('vis_vs', fragment, 'front'),
      make('vis_vs', fragment, 'front', 'cw'),
      rest('back'),
      rest('none'),
      rest('front'),
    ]);
    return {
      visPipelineBack: back,
      visPipelineBackCw: backCw,
      visPipelineNone: none,
      visPipelineFront: front,
      visPipelineFrontCw: frontCw,
      visHizRestBack: restBack,
      visHizRestNone: restNone,
      visHizRestFront: restFront,
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
    const pipelines: Promise<GPURenderPipeline>[] = [];
    for (let layer = 1; layer < layerSlots; layer++)
      for (const rest of [false, true])
        for (const [cullMode, frontFace] of LAYER_CULLS)
          pipelines.push(
            buildRenderPipeline(device, {
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
    return Promise.all(pipelines);
  });
}
/** Builds the depth export and class-specialized material pipelines during preparation. */
export function createWebgpuShadePipelines(
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  classes: readonly number[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
) {
  const shadeBindGroupLayout = sharedLayout ?? shadeLayout(device);
  const layout = device.createPipelineLayout({ bindGroupLayouts: [shadeBindGroupLayout] });
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
  const classDepth: GPUDepthStencilState = {
    format: MATERIAL_DEPTH_FORMAT,
    depthWriteEnabled: false,
    depthCompare: 'equal',
  };
  const entryPoint = feedback ? shadeVariantFragment(variant) : 'shade_fsWithoutFeedback';
  /** Class features and depth derive from the key; a single class rejects background itself. */
  const shadeDescriptor = (key: number, single: boolean): GPURenderPipelineDescriptor => {
    const constants: Record<string, number> = single
      ? { CLASS_KEY: key, SINGLE_CLASS: 1 }
      : { CLASS_KEY: key };
    return {
      layout,
      vertex: { module: shadeModule, entryPoint: 'shade_vs', constants },
      fragment: {
        module: shadeModule,
        entryPoint,
        constants,
        // The surfaces, then the tile request the image's feedback target receives.
        targets: shadeTargetFormats(feedback).map((format) => ({ format })),
      },
      primitive,
      depthStencil: single ? undefined : classDepth,
    };
  };
  // A class a frame meets later compiles at once; those of the scene compile here, together.
  const shadePipelineFor = (key: number) =>
    device.createRenderPipeline(shadeDescriptor(key, false));
  const single = classes.length === 1 && !variesShade(variant);
  return scoped(device, async () => {
    const [materialDepthPipeline, singlePipeline, shaded] = await Promise.all([
      buildRenderPipeline(device, {
        layout,
        vertex: { module: shadeModule, entryPoint: 'shade_vs' },
        fragment: { module: shadeModule, entryPoint: 'material_depth_fs', targets: [] },
        primitive,
        depthStencil: { ...classDepth, depthWriteEnabled: true, depthCompare: 'always' },
      }),
      single ? buildRenderPipeline(device, shadeDescriptor(classes[0], true)) : undefined,
      Promise.all(classes.map((key) => buildRenderPipeline(device, shadeDescriptor(key, false)))),
    ]);
    const singleShadePipelines = new Map<number, GPURenderPipeline>();
    if (singlePipeline) singleShadePipelines.set(classes[0], singlePipeline);
    return {
      shadeBindGroupLayout,
      materialDepthPipeline,
      shadePipelineFor,
      shadePipelines: new Map(classes.map((key, at) => [key, shaded[at]])),
      singleShadePipelines,
    };
  });
}
