import {
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import { HIZ_FORMAT, HIZ_LEVELS } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'

/**
 * The depth pyramid the view grid's cull reads (`cullWgsl.ts`), as group 1 of its pass: the
 * pyramid's texture and its levels uniform, the last two resources of `GpuHiz.depth`. A new group
 * follows each new `HizDepth` — the pyramid is made again at every resize —; with no pyramid, a
 * stand-in of one texel and a levels uniform that counts no level, which the cull reads as
 * "everything shows".
 */
export function createCullBinding(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [computeTextureEntry(0, 'uint', '2d-array'), computeUniformEntry(1)],
  })
  const texture = device.createTexture({
    label: 'Trillion3D light grid cull stand-in',
    size: [1, 1, 3],
    format: HIZ_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const levels = device.createBuffer({
    label: 'Trillion3D light grid cull levels stand-in',
    size: HIZ_LEVELS.words * 4,
    usage: GPUBufferUsage.UNIFORM,
  })
  const made = (resources: GPUBindingResource[]) =>
    device.createBindGroup({ layout, entries: sequentialEntries(resources) })
  const none = made([texture.createView({ dimension: '2d-array' }), { buffer: levels }])
  let held: { depth: HizDepth; group: GPUBindGroup } | undefined
  return {
    layout,
    /** The group of `depth`'s pyramid, or the stand-in's. */
    group(depth?: HizDepth) {
      if (!depth) return none
      if (held?.depth !== depth)
        held = { depth, group: made([depth.resources[1], depth.resources[2]]) }
      return held.group
    },
    dispose() {
      held = undefined
      texture.destroy()
      levels.destroy()
    },
  }
}
