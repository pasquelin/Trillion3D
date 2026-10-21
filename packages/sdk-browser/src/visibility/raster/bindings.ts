import { smallBindEntries, type SmallBindResources } from '../../gpu/bind/bindEntries.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { bufferEntry, liveResources } from '../../gpu/bind/liveEntries.ts'
import { VIS_UNIFORM_BYTES } from '../../gpu/bind/bindLayout.ts'
import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import type { GpuRasterInput } from './types.ts'
import { RASTER_PASS_POST, type RasterPass } from './contract.ts'

/** The hardware raster's second group: the visibility buffer its fragments write
 *  (`../shader/visWgsl.ts`), one a device, every visibility pipeline's (`../passes/pipelines.ts`). */
export const hardwareWorkLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [computeBufferEntry(0, 'storage', GPUShaderStage.FRAGMENT)],
  }),
)

/**
 * The raster's groups, each made again when a resource it names moved: the software raster's
 * (`raster`), its binning's (`bin`, `./binWgsl.ts`) — one a pass of the cut, apart by the uniform
 * entry it reads its mask's offset from —, and the hardware raster's group over `work`
 * (`hardware`).
 */
export function createRasterBindings(
  device: GPUDevice,
  layouts: { raster: GPUBindGroupLayout; bin: GPUBindGroupLayout },
  work: GPUBuffer,
) {
  const rasterIdentity = createWebgpuBindIdentity(),
    binIdentities: WebgpuBindIdentity[] = []
  let rasterGroup: GPUBindGroup | undefined
  const binGroups: Array<GPUBindGroup | undefined> = []
  let current: GpuRasterInput
  const hardware = device.createBindGroup({
    layout: hardwareWorkLayout(device),
    entries: [{ binding: 0, resource: { buffer: work } }],
  })
  return {
    hardware,
    raster(input: GpuRasterInput) {
      current = input
      const entries = (rasterIdentity.entries[0] ??= smallBindEntries(
        liveResources<SmallBindResources>({
          indices: () => current.indices,
          positions: () => current.positions,
          pages: () => current.pages,
          uniform: () => current.uniform,
          uvs: () => current.uvs,
          textures: () => current.textures,
          sampler: () => current.sampler,
          work: () => work,
          material: () => current.material,
          normals: () => current.normals,
        }),
      ))
      if (rasterIdentity.entriesMoved(layouts.raster)) rasterGroup = undefined
      return (rasterGroup ??= device.createBindGroup({ layout: layouts.raster, entries }))
    },
    bin(input: GpuRasterInput, pass: RasterPass) {
      current = input
      const identity = (binIdentities[pass] ??= createWebgpuBindIdentity())
      // The binning's group, binding after binding as `binLayoutEntries` lists them: the main
      // pass's uniform entry holds the frame mask's offset, the post pass's the post mask's.
      const entries = (identity.entries[0] ??= [
        bufferEntry(0, () => current.indices),
        bufferEntry(1, () => current.positions),
        bufferEntry(2, () => current.pages),
        bufferEntry(
          3,
          () => current.uniform,
          () => (pass === RASTER_PASS_POST ? current.postUniformOffset : 0),
          () => VIS_UNIFORM_BYTES,
        ),
        bufferEntry(4, () => work),
        // Without a selection the image reads no mask (`uni.selectionEnabled`): any `array<u32>`
        // the kernel only reads binds — the indices, read-only at binding 0 too —, never the page
        // table, which binding 2 writes (one buffer may not be both writable and read-only in a
        // dispatch).
        bufferEntry(5, () => current.selection?.maskBuffer ?? current.indices),
        bufferEntry(6, () => current.items),
      ])
      if (identity.entriesMoved(layouts.bin)) binGroups[pass] = undefined
      return (binGroups[pass] ??= device.createBindGroup({ layout: layouts.bin, entries }))
    },
  }
}
