import { smallBindEntries, type SmallBindResources } from '../../gpu/bind/bindEntries.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { liveResources } from '../../gpu/bind/liveEntries.ts'
import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import type { GpuRasterInput } from './types.ts'

/** The hardware raster's second group, on a device with the 64-bit atomic maximum: the visibility
 *  buffer its fragments write (`../shader/visWgsl.ts`), one a device, every visibility pipeline's
 *  (`../passes/pipelines.ts`). */
export const hardwareWorkLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [computeBufferEntry(0, 'storage', GPUShaderStage.FRAGMENT)],
  }),
)

/** The software raster's entries over the image `current()` reads, `work` and the pass lists `lists`. */
const rasterEntries = (current: () => GpuRasterInput, work: GPUBuffer, lists: () => GPUBuffer) =>
  smallBindEntries(
    liveResources<SmallBindResources>({
      indices: () => current().indices,
      positions: () => current().positions,
      pages: () => current().pages,
      uniform: () => current().uniform,
      uvs: () => current().uvs,
      textures: () => current().textures,
      sampler: () => current().sampler,
      work: () => work,
      lists,
      material: () => current().material,
      normals: () => current().normals,
      frame: () => current().frame,
      noise: () => current().noise,
    }),
  )

/**
 * The raster's groups, each made again when a resource it names moved: the software raster's
 * (`raster`), over the visibility buffer `work` and the lists `lists()` reads live, and, on a device
 * with the 64-bit atomic maximum (`wide`), the hardware raster's group over `work` (`hardware`).
 */
export function createRasterBindings(
  device: GPUDevice,
  layouts: { raster: GPUBindGroupLayout },
  work: GPUBuffer,
  lists: () => GPUBuffer,
  wide: boolean,
) {
  const rasterIdentity = createWebgpuBindIdentity()
  let rasterGroup: GPUBindGroup | undefined
  let current: GpuRasterInput
  const read = () => current
  const hardware = wide
    ? device.createBindGroup({
        layout: hardwareWorkLayout(device),
        entries: [{ binding: 0, resource: { buffer: work } }],
      })
    : undefined
  return {
    hardware,
    raster(input: GpuRasterInput) {
      current = input
      const entries = (rasterIdentity.entries[0] ??= rasterEntries(read, work, lists))
      if (rasterIdentity.entriesMoved(layouts.raster)) rasterGroup = undefined
      return (rasterGroup ??= device.createBindGroup({ layout: layouts.raster, entries }))
    },
  }
}
