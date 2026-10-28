import { createLightingCache } from './liveShadingGpu.ts'
import type { State } from './liveShadingState.ts'

/**
 * The existence mask of a volume at a grid of `size` voxels (`RenderExistenceMaskWithLiveShading` then `DilateExistenceMask`,
 * `HeterogeneousVolumesAmbientOcclusionPipeline.cpp:236-430`): a first pass marks each voxel whose centre has extinction, a second
 * dilates the mark to the voxels round it. Returned as the texture the lighting cache and the occlusion read to skip the voxels
 * where the volume is empty; none while the pipelines compile. `rawGroup` makes the bind group of the pass that writes the mask
 * into `raw`, `dilateGroup` that of the pass that reads `raw` and writes `dilated`. Both textures are kept by `key` and size.
 */
export function existenceMaskOf(c: {
  held: State
  device: GPUDevice
  encoder: GPUCommandEncoder
  existence: GPUComputePipeline | undefined
  dilate: GPUComputePipeline | undefined
  size: readonly [number, number, number]
  key: string
  rawGroup(raw: GPUTexture): GPUBindGroup
  dilateGroup(raw: GPUTexture, dilated: GPUTexture): GPUBindGroup
}) {
  const { held, device, encoder, size, key } = c
  if (!c.existence || !c.dilate) return undefined
  const textureOf = (role: string) => {
    const at = `${role}:${key}:${size.join('x')}`
    let texture = held.caches.get(at)
    if (!texture) {
      for (const [other, old] of held.caches)
        if (other.startsWith(`${role}:${key}:`)) (old.destroy(), held.caches.delete(other))
      held.caches.set(at, (texture = createLightingCache(device, size, `${key} ${role}`)))
    }
    return texture
  }
  const raw = textureOf('mask')
  const dilated = textureOf('dilated')
  const groups = [Math.ceil(size[0] / 4), Math.ceil(size[1] / 4), Math.ceil(size[2] / 4)] as const
  const pass = encoder.beginComputePass({ label: 'Trillion3D heterogeneous volume existence' })
  pass.setPipeline(c.existence)
  pass.setBindGroup(0, c.rawGroup(raw))
  pass.dispatchWorkgroups(...groups)
  pass.end()
  const second = encoder.beginComputePass({
    label: 'Trillion3D heterogeneous volume existence dilation',
  })
  second.setPipeline(c.dilate)
  second.setBindGroup(0, c.dilateGroup(raw, dilated))
  second.dispatchWorkgroups(...groups)
  second.end()
  return dilated
}
