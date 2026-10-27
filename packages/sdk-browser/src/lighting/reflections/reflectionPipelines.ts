/** THE REFLECTIONS' KERNELS AND THEIR GROUP'S LAYOUT, once a device: what every view's reflection
 *  (`gpu.ts`) and the forward programs that read it bind. */
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { shaderFailed } from '../../gpu/core/shaderModule.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { skyLightReadLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import { hizDepthEntries, hizLevelZeroEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { reflectionTraceShader } from './trace/trace.ts'
import { hardwareSceneLayout, hardwareTraceLayout, traceLayouts } from './trace/traceBindings.ts'
import { createTraceStages } from './trace/traceEncode.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_FRONT_BINDING,
  REFLECTION_IMAGE_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SKY_LIGHT,
  REFLECTION_VIEW_BINDING,
  REFLECTION_VIEW_BYTES,
} from './viewLayout.ts'

/** The parts of the reflection group a layout holds beside the view, the lighting's view and the sky light, which every layout holds: the depth (the whole
 *  pyramid, its first level alone, or none), the lit image the last image lit and the transparents' front depth. */
interface ReflectionParts {
  depth: 'pyramid' | 'level0' | 'none'
  image: boolean
  front: boolean
}

/** The entries of the reflection group (`reflectionBindingsWgsl`) as `visibility` sees them, holding `parts`, in the group's order: the view uniform, the depth
 *  (`hizDepthEntries`), the lighting's view, the lit image (`hdrTargetDescriptor`), the front depth, the sky light. */
const reflectionEntries = (visibility: GPUShaderStageFlags, parts: ReflectionParts) => [
  computeUniformEntry(REFLECTION_VIEW_BINDING, { minBindingSize: REFLECTION_VIEW_BYTES }, visibility),
  ...(parts.depth === 'pyramid' ? hizDepthEntries(REFLECTION_DEPTH_BINDING, visibility) : []),
  ...(parts.depth === 'level0' ? hizLevelZeroEntries(REFLECTION_DEPTH_BINDING, visibility) : []),
  computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform', visibility),
  ...(parts.image
    ? [computeTextureEntry(REFLECTION_IMAGE_BINDING, 'float', '2d', visibility)]
    : []),
  // The transparents' front depth, a depth texture read as the float it holds.
  ...(parts.front
    ? [computeTextureEntry(REFLECTION_FRONT_BINDING, 'unfilterable-float', '2d', visibility)]
    : []),
  // The sky light: its cubes, sampler, harmonics and the view's uniform.
  ...skyLightReadLayoutEntries(REFLECTION_SKY_LIGHT, visibility),
]

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, then the
 *  depth pyramid, the lighting's view and the lit image the last image lit, the front depth, read by compute and fragment stages. */
export const reflectionLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: reflectionEntries(COMPUTE | GPUShaderStage.FRAGMENT, {
      depth: 'pyramid',
      image: true,
      front: true,
    }),
  }),
)

/** The forward programs' reflection group layout, once a device: of the reflection group's bindings (`reflectionLayout`) the ones a forward
 *  fragment reads — the view uniform, level 0 of the depth (the screen segment of a translucent surface's traced shadow reads it,
 *  `vsmScreenSegmentWgsl`) and its levels, the lighting's view, the front depth and the sky light —, not the depth pyramid nor the lit
 *  image, which only the trace reads: two of the fragment stage's sixteen sampled textures spared. */
export const reflectionForwardLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: reflectionEntries(GPUShaderStage.FRAGMENT, {
      depth: 'level0',
      image: false,
      front: true,
    }),
  }),
)

/** The reflection group layout of the screen probes' scene stages, once a device: of the reflection group's bindings (`reflectionLayout`) the ones a ray
 *  answered by the scene reads — the view uniform, the lighting's view and the sky light —, not the depth, the lit image nor the front depth, which only the
 *  screen's trace and the pixels read: four of the compute stage's sixteen sampled textures spared, which the fog laid over the rays needs. */
export const reflectionSceneLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: reflectionEntries(COMPUTE, { depth: 'none', image: false, front: false }),
  }),
)

/** The reflection's kernels — the tiles' classification, the trace, reuse, accumulation and filter of
 *  both surfaces — compiled once a device under one validation scope, with the counting of the rays
 *  (`statistics`, `reflectionStatistics`) or without it, each kept apart. */
const kernelsOf = (statistics: boolean) =>
  oncePerDevice((device: GPUDevice) =>
    validated(device, async () => {
      const trace = device.createShaderModule({
        label: 'Trillion3D reflection trace',
        code: reflectionTraceShader(statistics),
      })
      // Every layout is made before the first `await`, in the scope.
      const group = reflectionLayout(device),
        layouts = traceLayouts(device, statistics)
      if (await shaderFailed(trace)) return undefined
      return createTraceStages(device, { trace }, group, layouts)
    }),
  )
const counting = kernelsOf(true),
  silent = kernelsOf(false)
export const createReflectionPipelines = (device: GPUDevice, statistics = false) =>
  (statistics ? counting : silent)(device)
export type ReflectionPipelines = NonNullable<Awaited<ReturnType<typeof createReflectionPipelines>>>

/** The entry the scene stage runs, in either of its programs. */
const SCENE_ENTRY = 'traceScene'

/**
 * The scene stage that casts its rays through the scene's triangles (`reflectionTraceShader` with `hardware`), made once for the device when
 * a scene has acceleration structures and its reflections are traced that way: its pipeline for the opaque surface and for the transparents'
 * front one, compiled off the frame and not waited for by the reflections' own kernels — until it is `ready` the rays are marched through the
 * field. Its layouts are its own group 0, the reflection group and the scene trace's.
 */
export const hardwareReflectionKernels = oncePerDevice((device: GPUDevice) => {
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [
      hardwareSceneLayout(device),
      reflectionLayout(device),
      hardwareTraceLayout(device),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D reflection scene trace',
    code: reflectionTraceShader(false, true),
  })
  // The surface's layer, the pipeline's (`REFLECTION_LAYER_WGSL`): 0 the opaque, 1 the front.
  const stages = [0, 1].map((layer) =>
    startedComputeStages(
      device,
      `Trillion3D reflection scene trace ${layer}`,
      layout,
      module,
      [SCENE_ENTRY],
      { REFLECTION_LAYER: layer },
    ),
  )
  return {
    get ready() {
      return stages.every((stage) => stage.ready)
    },
    /** The compiled pipeline of the surface `layer`: read once `ready`. */
    pipeline: (layer: number) => stages[layer].pipelineOf(SCENE_ENTRY),
  }
})
