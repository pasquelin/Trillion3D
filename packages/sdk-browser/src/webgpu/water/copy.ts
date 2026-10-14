import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { VERDICT } from '../blend/verdictLayout.ts'
import { WATER_COPY_SHADER } from './copyWgsl.ts'
import { WATER_BACKDROP_PASS } from './passLabels.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'

/**
 * The backdrop freeze of the water pass: the lit image copied over the backdrop rectangle the GPU
 * wrote — the union of what the water surfaces may refract, or the full target —, dispatched
 * indirectly over its 8×8 tiles, none when no water draws. The CPU names neither the rectangle nor
 * whether there is one: WebGPU's texture copy takes its size from the CPU, a compute copy from the
 * GPU. The HDR target is one of two that take turns (`reflections/radiance.ts`): a group is held
 * for each.
 */
export async function createWaterCopy(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, WATER_COPY_SHADER, 'WATER_COPY')
  const layout = device.createBindGroupLayout({
    entries: [
      computeTextureEntry(0, 'unfilterable-float'),
      computeStorageTextureEntry(1, HDR_FORMAT),
      computeBufferEntry(2, 'read-only-storage'),
    ],
  })
  const { copyBackdrop } = await buildComputeStages(device, [layout], module, ['copyBackdrop'])
  const identity = createWebgpuBindIdentity(2),
    groups: (GPUBindGroup | undefined)[] = []
  let verdict: GPUBuffer | undefined
  return {
    /** This image's lit target, the backdrop and the verdict: a group made only for a new one. */
    bind(lit: GPUTextureView, backdrop: GPUTextureView, source: GPUBuffer) {
      const named = identity.next
      named[0] = lit
      named[1] = backdrop
      named[2] = source
      named.length = 3
      verdict = source
      if (!identity.moved() && groups[identity.slot]) return
      groups[identity.slot] = device.createBindGroup({
        layout,
        entries: sequentialEntries([lit, backdrop, { buffer: source }]),
      })
    },
    encode(encoder: GPUCommandEncoder) {
      const pass = encoder.beginComputePass({ label: WATER_BACKDROP_PASS })
      pass.setPipeline(copyBackdrop)
      pass.setBindGroup(0, groups[identity.slot]!)
      pass.dispatchWorkgroupsIndirect(verdict!, VERDICT.copyArgs * 4)
      pass.end()
    },
    dispose() {
      groups.length = 0
      verdict = undefined
    },
  }
}
