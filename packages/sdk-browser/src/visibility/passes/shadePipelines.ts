import { shadeLayout, shadeOutputLayout } from './shadeLayout.ts'
import { scoped } from './pipelines.ts'
import {
  preparedComputePipeline,
  type PreparedPipeline,
} from '../../lighting/deferred/fullscreen.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import {
  DIAGNOSTIC_SHADE_WGSL,
  shadeVariantEntry,
  variesShade,
} from '../../diagnostic/gpuGeometry.ts'
import { CLASS_FEATURE } from '../shader/classWords.ts'
import { shadeShader } from '../shader/shadeWgsl.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { feedbackConstants } from '../../materials/virtual/requestWgsl.ts'
import { displacedShadeLayout } from '../tessellation/prismFrame.ts'

/** The resolve's class pipelines: one per class key (`../shader/materialClass.ts`),
 *  prepared before the image that shades the class (`PreparedPipeline`), never by it. */
export type ShadeClasses = {
  /** The pipeline of class `key`. */
  of(key: number): PreparedPipeline<GPUComputePipeline>
  /** The pipeline of class `key` for the displaced pixels its rows draw: its resolve places a pixel
   *  on the displaced triangle (`../tessellation/prismWgsl.ts`), over a group 0 that adds the
   *  depth and the view's numbers (`displacedShadeLayout`). Made when a scene tessellates one. */
  displaced(key: number): PreparedPipeline<GPUComputePipeline>
  /** The classes made so far: those of the census, and those asked since. */
  keys(): Iterable<number>
  /** The same classes writing the layer, made once — itself when it writes it: what a scene whose
   *  surface came to emit or occlude switches to once they are compiled
   *  (`../../frame/loop/framePipelines.ts`). */
  withEmissiveAo(): ShadeClasses
}

/** The modules a class's resolve is made over, each made the first time one is asked, so that a scene
 *  without the kind compiles what it did before: the shared one (`shadeModule`); a voxel class's
 *  own (`shadeShader`'s voxel text); and a displaced class's, with the layout of its own group 0 —
 *  the resolve's, plus the depth and the view's numbers. */
function classModules(
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  variant: DiagnosticGpuVariant | undefined,
) {
  const diagnostic = () => (variesShade(variant) ? { diagnostic: DIAGNOSTIC_SHADE_WGSL } : {})
  let voxelModule: GPUShaderModule | undefined
  let displacedModule: GPUShaderModule | undefined, displacedLayout: GPUPipelineLayout | undefined
  return {
    moduleOf: (key: number) =>
      (key & CLASS_FEATURE.VOXEL) === 0
        ? shadeModule
        : (voxelModule ??= device.createShaderModule({
            code: shadeShader({ voxel: true, ...diagnostic() }),
          })),
    displacedParts: () => ({
      layout: (displacedLayout ??= device.createPipelineLayout({
        bindGroupLayouts: [displacedShadeLayout(device), shadeOutputLayout(device)],
      })),
      module: (displacedModule ??= device.createShaderModule({
        code: shadeShader({ displaced: true, ...diagnostic() }),
      })),
    }),
  }
}

/** Builds the class-specialized material pipelines during preparation: each a compute stage that
 *  shades the pixels of its class's bin, one indirect dispatch an image
 *  (`../../materials/classes/shadeBins.ts`). Without `emissiveAo`, the emission-and-occlusion target
 *  is left as it was cleared and its mark never set (`EMISSIVE_AO`,
 *  `../../materials/surface/surfaceEmission.ts`). The census's classes compile here, together; one a
 *  material changed into since is asked before the image that shades it. */
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
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [shadeBindGroupLayout, shadeOutputLayout(device)],
  })
  // One entry with the feedback target or without it: its request folded by `FEEDBACK`.
  const entryPoint = shadeVariantEntry(variant)
  const fed = feedbackConstants(feedback)
  const { moduleOf, displacedParts } = classModules(device, shadeModule, variant)
  /** Class features derive from the key; the layer's store is folded away without it. */
  const shadeDescriptor = (
    key: number,
    layer: boolean,
    displaced = false,
  ): GPUComputePipelineDescriptor => {
    const constants: Record<string, number> = { CLASS_KEY: key, ...fed }
    if (!layer) constants.EMISSIVE_AO = 0
    const { layout: used, module } = displaced
      ? displacedParts()
      : { layout, module: moduleOf(key) }
    return { layout: used, compute: { module, entryPoint, constants } }
  }
  const classSet = (layer: boolean): ShadeClasses => {
    const set = preparedPipelines((key: number) =>
      preparedComputePipeline(device, shadeDescriptor(key, layer)),
    )
    const displaced = preparedPipelines((key: number) =>
      preparedComputePipeline(device, shadeDescriptor(key, layer, true)),
    )
    let layered: ShadeClasses | undefined
    const shade: ShadeClasses = {
      ...set,
      displaced: displaced.of,
      withEmissiveAo: () => (layer ? shade : (layered ??= classSet(true))),
    }
    return shade
  }
  return scoped(device, async () => {
    const shadeClasses = classSet(emissiveAo)
    await Promise.all(classes.map((key) => shadeClasses.of(key).prepare()))
    return { shadeBindGroupLayout, shadeClasses }
  })
}
