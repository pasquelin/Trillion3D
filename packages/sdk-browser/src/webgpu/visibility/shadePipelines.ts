import { shadeLayout } from './shadeLayout.ts';
import { scoped } from './pipelines.ts';
import {
  preparedPipeline,
  preparedPipelines,
  type PreparedPipeline,
} from '../../lighting/deferred/fullscreen.ts';
import { shadeVariantFragment, variesShade } from '../../diagnostic/gpuGeometry.ts';
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts';
import { shadeTargetFormats } from './shadeTargets.ts';
import { createMaterialTiles, materialTileDrawLayout } from '../core/materialTiles.ts';

/** The resolve's class pipelines: one per class key (`../../visibility/shader/materialClass.ts`),
 *  prepared before the image that draws the class (`PreparedPipeline`), never by it. */
export type ShadeClasses = {
  /** The pipeline of class `key`. */
  of(key: number): PreparedPipeline<GPURenderPipeline>;
  /** The classes made so far: those of the census, and those asked since. */
  keys(): Iterable<number>;
  /** Direct resolve of a one-class image, for the scene's class at preparation — its fragment
   *  stage rejects the background —; none for another class. Each set holds its own, prepared as
   *  its classes are and asked with them (`../frame/framePipelines.ts`). */
  single(key: number): PreparedPipeline<GPURenderPipeline> | undefined;
  /** The same classes writing the layer, made once — itself when it writes it: what a scene whose
   *  surface came to emit or occlude switches to once they are compiled
   *  (`../frame/framePipelines.ts`). */
  withEmissiveAo(): ShadeClasses;
};

/** Builds the class-specialized material pipelines and, for the image's own resolve, its material
 *  tiles (`../core/materialTiles.ts`) during preparation. A class's fragment stage rejects every
 *  pixel not of its class before any write (`classAdmits`): no depth target sorts them. Without
 *  `emissiveAo`, the emission-and-occlusion target is left empty and its mark never set
 *  (`EMISSIVE_AO`, `../../scene/surfaceEmission.ts`). The census's classes compile here, together;
 *  one a material changed into since is asked before the image that draws it. */
export function createWebgpuShadePipelines(
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  classes: readonly number[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
  emissiveAo = true,
  /** What the frame's cache holds for the pixels to read (`./shadeCache.ts`); none, each composes. */
  cached: Readonly<Record<string, number>> = {},
) {
  const shadeBindGroupLayout = sharedLayout ?? shadeLayout(device);
  const layout = device.createPipelineLayout({ bindGroupLayouts: [shadeBindGroupLayout] });
  // A class draws its tiles only (`materialTiles.ts`).
  const tileDrawLayout = materialTileDrawLayout(device);
  const tileLayout = device.createPipelineLayout({
    bindGroupLayouts: [shadeBindGroupLayout, tileDrawLayout],
  });
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
  const entryPoint = feedback ? shadeVariantFragment(variant) : 'shade_fsWithoutFeedback';
  /** Class features derive from the key; a single class draws full screen, every other the tiles
   *  its pixels are in. */
  const shadeDescriptor = (
    key: number,
    single: boolean,
    layer: boolean,
  ): GPURenderPipelineDescriptor => {
    const constants: Record<string, number> = single
      ? { ...cached, CLASS_KEY: key, SINGLE_CLASS: 1 }
      : { ...cached, CLASS_KEY: key };
    if (!layer) constants.EMISSIVE_AO = 0;
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
        targets: shadeTargetFormats(feedback).map((format, at) =>
          at === 2 && !layer ? null : { format },
        ),
      },
      primitive,
    };
  };
  const classSet = (layer: boolean, singleKey: number | undefined): ShadeClasses => {
    const set = preparedPipelines((key: number) =>
      preparedPipeline(device, shadeDescriptor(key, false, layer)),
    );
    const direct =
      singleKey === undefined
        ? undefined
        : preparedPipeline(device, shadeDescriptor(singleKey, true, layer));
    let layered: ShadeClasses | undefined;
    const shade: ShadeClasses = {
      ...set,
      single: (key) => (key === singleKey ? direct : undefined),
      withEmissiveAo: () => (layer ? shade : (layered ??= classSet(true, singleKey))),
    };
    return shade;
  };
  const singleKey = classes.length === 1 && !variesShade(variant) ? classes[0] : undefined;
  return scoped(device, async () => {
    const shadeClasses = classSet(emissiveAo, singleKey);
    const [materialTiles] = await Promise.all([
      // The scene's resolve classifies its tiles; a set built beside it on its layout — the
      // feedback A/B's arm, the other feedback variant (`../pages/prepare/feedbackVariant.ts`) —
      // draws on those lists.
      sharedLayout ? undefined : createMaterialTiles(device, tileDrawLayout),
      singleKey === undefined ? undefined : shadeClasses.single(singleKey)!.prepare(),
      Promise.all(classes.map((key) => shadeClasses.of(key).prepare())),
    ]);
    return { shadeBindGroupLayout, materialTiles, shadeClasses };
  });
}
