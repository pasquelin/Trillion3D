import { depthLayerUnits } from '../../../../sdk-core/src/index.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { validationScope } from '../../gpu/core/errorScope.ts';
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts';
import { visVariantFragment } from '../../diagnostic/gpuGeometry.ts';
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts';

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
export async function scoped<T>(device: GPUDevice, run: () => Promise<T>): Promise<T> {
  const { value, error } = await validationScope(device, run);
  if (error) throw error;
  return value;
}
/** The visibility raster's targets: the identifiers, and the pyramid's level 0 when `hiz`. Every
 *  raster drawing into the visibility pass — clusters and impostor cards — uses these. */
const VIS_TARGETS: GPUColorTargetState[] = [{ format: 'r32uint' }];
const VIS_HIZ_TARGETS: GPUColorTargetState[] = [{ format: 'r32uint' }, { format: 'r32float' }];
export const visTargets = (hiz: boolean) => (hiz ? VIS_HIZ_TARGETS : VIS_TARGETS);
/** The visibility raster's depth: written, tested as every opaque raster. */
export const VIS_DEPTH: GPUDepthStencilState = {
  format: 'depth32float',
  depthWriteEnabled: true,
  depthCompare: DEPTH_COMPARE,
};

export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
  variant?: DiagnosticGpuVariant,
) {
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const targets = visTargets(hiz);
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
      depthStencil: VIS_DEPTH,
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
  const targets = visTargets(hiz);
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
