import { HIZ_WITH_TRACE, HIZ_SHADER } from './shader.ts'
import { HIZ_PRIMED_BINDING, HIZ_PRIMED_BYTES, HIZ_PRIMED_SHADER } from './primedWgsl.ts'
import { hizBindEntries } from './bindEntries.ts'
import { buildComputeStage, preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { validated } from '../../../gpu/core/errorScope.ts'
import { shaderFailed } from '../../../gpu/core/shaderModule.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { HIZ_SLOT_WORDS } from './uniforms.ts'

/**
 * The Hi-Z kernels — the culling layer's build and the full build with the trace layers, one kernel specialized (`HIZ_WITH_TRACE`) —
 * compiled under one device validation scope, once a device: every pyramid of the device shares
 * them, so a pyramid made later compiles nothing.
 */
export const createHizPipelines = oncePerDevice((device) =>
  validated(device, async () => {
    const layout = device.createBindGroupLayout({
      entries: hizBindEntries(HIZ_SLOT_WORDS * 4),
    })
    const module = device.createShaderModule({ code: HIZ_SHADER })
    if (await shaderFailed(module)) return undefined
    const stage = (constants?: Record<string, number>) =>
      buildComputeStage(device, [layout], module, 'buildHiz', constants)
    const [buildPipeline, fullPipeline] = await Promise.all([
      stage(),
      stage({ [HIZ_WITH_TRACE]: 1 }),
    ])
    return { layout, buildPipeline, fullPipeline }
  }),
)

/**
 * The build of the primed pyramid (`hizShader`, primed): the culling layer's kernel with the push
 * of its level 0, on a layout of its own — the build's three bindings and the push's uniform —,
 * asked off the thread once a device, by the image that builds one (`hizPrime`). The images that
 * never prime compile nothing.
 */
export const hizPrimedPipeline = oncePerDevice((device) => {
  const layout = device.createBindGroupLayout({
    entries: [
      ...hizBindEntries(HIZ_SLOT_WORDS * 4),
      computeUniformEntry(HIZ_PRIMED_BINDING, { minBindingSize: HIZ_PRIMED_BYTES }),
    ],
  })
  const stage = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({ code: HIZ_PRIMED_SHADER }),
    'buildHiz',
    undefined,
    'Trillion3D Hi-Z primed build',
  )
  return { layout, stage }
})
