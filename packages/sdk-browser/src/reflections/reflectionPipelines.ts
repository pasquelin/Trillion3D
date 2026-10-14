import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { validated } from '../gpu/core/errorScope.ts'
import { shaderFailed } from '../gpu/core/shaderModule.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'
import { hizDepthEntries } from '../gpu/hiz/pyramidTexture.ts'
import { buildComputeStages } from '../gpu/core/computeStages.ts'
import { radianceLayouts } from './radiance.ts'
import { RADIANCE_SHADER } from './radianceWgsl.ts'
import { REFLECTION_TRACE_SHADER } from './traceHalf.ts'
import { createTraceStages } from './halfEncode.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_FRONT_BINDING,
  REFLECTION_IMAGE_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SAMPLER_BINDING,
  REFLECTION_VIEW_BYTES,
} from './viewLayout.ts'

/** THE REFLECTIONS' KERNELS AND THEIR GROUP'S LAYOUT, once a device: what every view's reflection
 *  (`gpu.ts`) and the forward programs that read it bind. */

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, the
 *  radiance pyramid's sampler, then the depth pyramid (`hizDepthEntries`), the lighting's view and
 *  the radiance pyramid, every level of it in one texture — the lit image itself at its level 0
 *  (`hdrTargetDescriptor`) —, read by compute and fragment stages. */
export const reflectionLayout = oncePerDevice((device: GPUDevice) => {
  const visibility = COMPUTE | GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0, { minBindingSize: REFLECTION_VIEW_BYTES }, visibility),
      { binding: REFLECTION_SAMPLER_BINDING, visibility, sampler: { type: 'filtering' } },
      ...hizDepthEntries(REFLECTION_DEPTH_BINDING, visibility),
      computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform', visibility),
      computeTextureEntry(REFLECTION_IMAGE_BINDING, 'float', '2d', visibility),
      // The transparents' front depth, a depth texture read as the float it holds.
      computeTextureEntry(REFLECTION_FRONT_BINDING, 'unfilterable-float', '2d', visibility),
    ],
  })
})

/** The reflection's kernels — the trace and the upsample of both surfaces, the radiance pyramid's —
 *  compiled once a device under one validation scope. */
export const createReflectionPipelines = oncePerDevice((device: GPUDevice) =>
  validated(device, async () => {
    const modules = {
      trace: device.createShaderModule({
        label: 'Trillion3D reflection trace',
        code: REFLECTION_TRACE_SHADER,
      }),
      radiance: device.createShaderModule({
        label: 'Trillion3D reflection radiance',
        code: RADIANCE_SHADER,
      }),
    }
    for (const made of Object.values(modules)) if (await shaderFailed(made)) return undefined
    const layouts = radianceLayouts(device)
    const [trace, first, down, roll] = await Promise.all([
      createTraceStages(device, modules.trace, reflectionLayout(device)),
      buildComputeStages(device, [layouts.firstLayout], modules.radiance, [
        'radianceFirst',
        'radianceFirstHashed',
        'radianceFirstBoth',
      ]),
      buildComputeStages(device, [layouts.downLayout], modules.radiance, ['radianceDown']),
      buildComputeStages(device, [layouts.rollLayout], modules.radiance, ['radianceRoll']),
    ])
    return {
      ...trace,
      ...layouts,
      firstPipeline: first.radianceFirst,
      firstHashedPipeline: first.radianceFirstHashed,
      firstBothPipeline: first.radianceFirstBoth,
      downPipeline: down.radianceDown,
      rollPipeline: roll.radianceRoll,
    }
  }),
)
export type ReflectionPipelines = NonNullable<Awaited<ReturnType<typeof createReflectionPipelines>>>
