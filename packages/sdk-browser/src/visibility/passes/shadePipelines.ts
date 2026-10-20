import { shadeLayout } from './shadeLayout.ts'
import { scoped } from './pipelines.ts'
import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import {
  DIAGNOSTIC_SHADE_WGSL,
  shadeVariantFragment,
  variesShade,
} from '../../diagnostic/gpuGeometry.ts'
import { CLASS_FEATURE } from '../shader/classWords.ts'
import { shadeShader } from '../shader/shadeWgsl.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { shadeTargetFormats } from './shadeTargets.ts'
import { feedbackConstants } from '../../materials/virtual/requestWgsl.ts'
import {
  createMaterialTiles,
  materialTileDrawLayout,
} from '../../materials/classes/materialTiles.ts'

/** The resolve's class pipelines: one per class key (`../shader/materialClass.ts`),
 *  prepared before the image that draws the class (`PreparedPipeline`), never by it. */
export type ShadeClasses = {
  /** The pipeline of class `key`. */
  of(key: number): PreparedPipeline<GPURenderPipeline>
  /** The classes made so far: those of the census, and those asked since. */
  keys(): Iterable<number>
  /** Direct resolve of a one-class image, for the scene's class at preparation — its fragment
   *  stage rejects the background —; none for another class. Each set holds its own, prepared as
   *  its classes are and asked with them (`../../frame/loop/framePipelines.ts`). */
  single(key: number): PreparedPipeline<GPURenderPipeline> | undefined
  /** The same classes writing the layer, made once — itself when it writes it: what a scene whose
   *  surface came to emit or occlude switches to once they are compiled
   *  (`../../frame/loop/framePipelines.ts`). */
  withEmissiveAo(): ShadeClasses
}

/** Builds the class-specialized material pipelines and, for the image's own resolve, its material
 *  tiles (`../../materials/classes/materialTiles.ts`) during preparation. A class's fragment stage rejects every
 *  pixel not of its class before any write (`classAdmits`): no depth target sorts them. Without
 *  `emissiveAo`, the emission-and-occlusion target is left empty and its mark never set
 *  (`EMISSIVE_AO`, `../../materials/surface/surfaceEmission.ts`). The census's classes compile here, together;
 *  one a material changed into since is asked before the image that draws it. */
export function createWebgpuShadePipelines(
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  classes: readonly number[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
  emissiveAo = true,
) {
  const shadeBindGroupLayout = sharedLayout ?? shadeLayout(device)
  const layout = device.createPipelineLayout({ bindGroupLayouts: [shadeBindGroupLayout] })
  // A class draws its tiles only (`materialTiles.ts`).
  const tileDrawLayout = materialTileDrawLayout(device)
  const tileLayout = device.createPipelineLayout({
    bindGroupLayouts: [shadeBindGroupLayout, tileDrawLayout],
  })
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' }
  // One entry with the feedback target or without it: its request folded by `FEEDBACK`.
  const entryPoint = shadeVariantFragment(variant)
  const fed = feedbackConstants(feedback)
  // A voxel class's resolve is its own module (`shadeShader`'s voxel text), made the first time
  // one is: a scene without voxels compiles the module it compiled before them.
  let voxelModule: GPUShaderModule | undefined
  const moduleOf = (key: number) =>
    (key & CLASS_FEATURE.VOXEL) === 0
      ? shadeModule
      : (voxelModule ??= device.createShaderModule({
          code: shadeShader({
            voxel: true,
            ...(variesShade(variant) && { diagnostic: DIAGNOSTIC_SHADE_WGSL }),
          }),
        }))
  /** Class features derive from the key; a single class draws full screen, every other the tiles
   *  its pixels are in. */
  const shadeDescriptor = (
    key: number,
    single: boolean,
    layer: boolean,
  ): GPURenderPipelineDescriptor => {
    const constants: Record<string, number> = single
      ? { CLASS_KEY: key, SINGLE_CLASS: 1 }
      : { CLASS_KEY: key }
    if (!layer) constants.EMISSIVE_AO = 0
    const module = moduleOf(key)
    return {
      layout: single ? layout : tileLayout,
      vertex: {
        module,
        entryPoint: single ? 'shade_vs' : 'shade_tile_vs',
        constants,
      },
      fragment: {
        module,
        entryPoint,
        constants: { ...constants, ...fed },
        // The surfaces, then the tile request the image's feedback target receives.
        targets: shadeTargetFormats(feedback).map((format, at) =>
          at === 2 && !layer ? null : { format },
        ),
      },
      primitive,
    }
  }
  const classSet = (layer: boolean, singleKey: number | undefined): ShadeClasses => {
    const set = preparedPipelines((key: number) =>
      preparedPipeline(device, shadeDescriptor(key, false, layer)),
    )
    const direct =
      singleKey === undefined
        ? undefined
        : preparedPipeline(device, shadeDescriptor(singleKey, true, layer))
    let layered: ShadeClasses | undefined
    const shade: ShadeClasses = {
      ...set,
      single: (key) => (key === singleKey ? direct : undefined),
      withEmissiveAo: () => (layer ? shade : (layered ??= classSet(true, singleKey))),
    }
    return shade
  }
  const singleKey = classes.length === 1 && !variesShade(variant) ? classes[0] : undefined
  return scoped(device, async () => {
    const shadeClasses = classSet(emissiveAo, singleKey)
    const [materialTiles] = await Promise.all([
      // The scene's resolve classifies its tiles; a set built beside it on its layout — the
      // feedback A/B's arm, the other feedback variant (`../../frame/prepare/feedbackVariant.ts`) —
      // draws on those lists.
      sharedLayout ? undefined : createMaterialTiles(device, tileDrawLayout),
      singleKey === undefined ? undefined : shadeClasses.single(singleKey)!.prepare(),
      Promise.all(classes.map((key) => shadeClasses.of(key).prepare())),
    ])
    return { shadeBindGroupLayout, materialTiles, shadeClasses }
  })
}
