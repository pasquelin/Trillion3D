import type { VolumetricLightmapData } from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'
import { createVolumetricLightmapTextures, volumetricLightmapGroupEntries } from './textures.ts'
import { VOLUMETRIC_LIGHTMAP_VIEW_WORDS, writeVolumetricLightmapView } from './view.ts'

/**
 * THE VOLUMETRIC LIGHTMAP ON THE GPU, made once for a session's lightmap and kept for its life: the
 * ten textures (`textures.ts`), the bilinear sampler they are read through, and the view block that
 * finds a position in them (`view.ts`), written shown. Whether the lightmap is read is the
 * `volumetricLightmap` setting's, which the passes that read it ask (`frame.ts`), not the
 * resources'.
 */
export function createVolumetricLightmapGpu(device: GPUDevice, data: VolumetricLightmapData) {
  const textures = createVolumetricLightmapTextures(device, data)
  const view = device.createBuffer({
    label: 'Trillion3D volumetric lightmap view',
    size: VOLUMETRIC_LIGHTMAP_VIEW_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const block = new Float32Array(VOLUMETRIC_LIGHTMAP_VIEW_WORDS)
  writeVolumetricLightmapView(block, 0, data, true)
  device.queue.writeBuffer(view, 0, block)
  const sampler = device.createSampler({
    label: 'Trillion3D volumetric lightmap',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  })
  return {
    data,
    /** The bind group entries of the lightmap's bindings from `first`
     *  (`VOLUMETRIC_LIGHTMAP_BINDINGS` of them). */
    entries: (first: number) =>
      volumetricLightmapGroupEntries(first, { buffer: view }, sampler, textures),
    /** Frees the textures and the view block. */
    dispose() {
      textures.destroy()
      view.destroy()
    },
  }
}

/** The lightmap on the GPU (`createVolumetricLightmapGpu`). */
export type VolumetricLightmapGpu = ReturnType<typeof createVolumetricLightmapGpu>
