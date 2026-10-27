/** THE REFLECTIONS' KERNELS AND THEIR GROUP'S LAYOUT, once a device: what every view's reflection
 *  (`gpu.ts`) and the forward programs that read it bind. */
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { shaderFailed } from '../../gpu/core/shaderModule.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { skyLightReadLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import { hizDepthEntries, hizLevelZeroEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { reflectionTraceShader } from './trace/trace.ts'
import { traceLayouts } from './trace/traceBindings.ts'
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

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, then the
 *  depth pyramid (`hizDepthEntries`), the lighting's view and the lit image the last image lit
 *  (`hdrTargetDescriptor`), the front depth, read by compute and fragment stages. */
export const reflectionLayout = oncePerDevice((device: GPUDevice) => {
  const visibility = COMPUTE | GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(
        REFLECTION_VIEW_BINDING,
        { minBindingSize: REFLECTION_VIEW_BYTES },
        visibility,
      ),
      ...hizDepthEntries(REFLECTION_DEPTH_BINDING, visibility),
      computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform', visibility),
      computeTextureEntry(REFLECTION_IMAGE_BINDING, 'float', '2d', visibility),
      // The transparents' front depth, a depth texture read as the float it holds.
      computeTextureEntry(REFLECTION_FRONT_BINDING, 'unfilterable-float', '2d', visibility),
      // The sky light: its cubes, sampler, harmonics and the view's uniform.
      ...skyLightReadLayoutEntries(REFLECTION_SKY_LIGHT, visibility),
    ],
  })
})

/** The forward programs' reflection group layout, once a device: of the reflection group's bindings (`reflectionLayout`) the ones a forward
 *  fragment reads — the view uniform, level 0 of the depth (the screen segment of a translucent surface's traced shadow reads it,
 *  `vsmScreenSegmentWgsl`) and its levels, the lighting's view, the front depth and the sky light —, not the depth pyramid nor the lit
 *  image, which only the trace reads: two of the fragment stage's sixteen sampled textures spared. */
export const reflectionForwardLayout = oncePerDevice((device: GPUDevice) => {
  const visibility = GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(
        REFLECTION_VIEW_BINDING,
        { minBindingSize: REFLECTION_VIEW_BYTES },
        visibility,
      ),
      ...hizLevelZeroEntries(REFLECTION_DEPTH_BINDING, visibility),
      computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform', visibility),
      computeTextureEntry(REFLECTION_FRONT_BINDING, 'unfilterable-float', '2d', visibility),
      ...skyLightReadLayoutEntries(REFLECTION_SKY_LIGHT, visibility),
    ],
  })
})

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
