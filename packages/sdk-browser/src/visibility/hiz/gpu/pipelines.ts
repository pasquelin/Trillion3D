import { HIZ_NEAREST_BUILD, HIZ_SHADER } from './shader.ts'
import { hizBindEntries } from './bindEntries.ts'
import { buildComputeStage } from '../../../gpu/core/computeStages.ts'
import { validated } from '../../../gpu/core/errorScope.ts'
import { shaderFailed } from '../../../gpu/core/shaderModule.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { HIZ_SLOT_WORDS } from './uniforms.ts'

/**
 * The Hi-Z kernels — the build of each layer, one kernel specialized (`HIZ_NEAREST_BUILD`) —
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
    const [buildPipeline, nearestPipeline] = await Promise.all([
      stage(),
      stage({ [HIZ_NEAREST_BUILD]: 1 }),
    ])
    return { layout, buildPipeline, nearestPipeline }
  }),
)
