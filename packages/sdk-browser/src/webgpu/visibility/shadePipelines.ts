import { shadeLayout } from './shadeLayout.ts';
import { scoped } from './pipelines.ts';
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts';
import { shadeVariantFragment, variesShade } from '../../diagnostic/gpuGeometry.ts';
import { MATERIAL_DEPTH_FORMAT } from '../../visibility/shader/materialClass.ts';
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts';
import { shadeTargetFormats } from './shadeTargets.ts';
import { createMaterialTiles, materialTileDrawLayout } from '../core/materialTiles.ts';

/** Builds the depth export, the class-specialized material pipelines and, for the image's own
 *  resolve, its material tiles (`../core/materialTiles.ts`) during preparation. */
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
  // A class drawn under the material depth draws its tiles only (`materialTiles.ts`).
  const tileDrawLayout = materialTileDrawLayout(device);
  const tileLayout = device.createPipelineLayout({
    bindGroupLayouts: [shadeBindGroupLayout, tileDrawLayout],
  });
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
  const classDepth: GPUDepthStencilState = {
    format: MATERIAL_DEPTH_FORMAT,
    depthWriteEnabled: false,
    depthCompare: 'equal',
  };
  const entryPoint = feedback ? shadeVariantFragment(variant) : 'shade_fsWithoutFeedback';
  /** Class features and depth derive from the key; a single class rejects background itself,
   *  full screen, and every other draws the tiles its pixels are in. */
  const shadeDescriptor = (key: number, single: boolean): GPURenderPipelineDescriptor => {
    const constants: Record<string, number> = single
      ? { CLASS_KEY: key, SINGLE_CLASS: 1 }
      : { CLASS_KEY: key };
    return {
      layout: single ? layout : tileLayout,
      vertex: {
        module: shadeModule,
        entryPoint: single ? 'shade_vs' : 'shade_tile_vs',
        constants,
      },
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
    const [materialDepthPipeline, singlePipeline, shaded, materialTiles] = await Promise.all([
      buildRenderPipeline(device, {
        layout,
        vertex: { module: shadeModule, entryPoint: 'shade_vs' },
        fragment: { module: shadeModule, entryPoint: 'material_depth_fs', targets: [] },
        primitive,
        depthStencil: { ...classDepth, depthWriteEnabled: true, depthCompare: 'always' },
      }),
      single ? buildRenderPipeline(device, shadeDescriptor(classes[0], true)) : undefined,
      Promise.all(classes.map((key) => buildRenderPipeline(device, shadeDescriptor(key, false)))),
      // The image's own resolve classifies its tiles; a diagnostic twin draws on those lists.
      feedback ? createMaterialTiles(device, tileDrawLayout) : undefined,
    ]);
    const singleShadePipelines = new Map<number, GPURenderPipeline>();
    if (singlePipeline) singleShadePipelines.set(classes[0], singlePipeline);
    return {
      shadeBindGroupLayout,
      materialTiles,
      materialDepthPipeline,
      shadePipelineFor,
      shadePipelines: new Map(classes.map((key, at) => [key, shaded[at]])),
      singleShadePipelines,
    };
  });
}
