import { computeSamplerEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { createWhiteCubemap } from './cubemapGpu.ts'
import type { FogResourceBindings } from './readWgsl.ts'

/** The format of the volumes: four half floats a cell. */
export const FOG_VOLUME_FORMAT: GPUTextureFormat = 'rgba16float'

/** What a program that reads the fog is bound to, past the light buffer: the cubemap, the integrated
 *  volume, and the sampler both are read through (`fogResourcesWgsl`). A new object where one of
 *  the views changed, so that a program that keeps its group compares the object. */
export interface FogRead {
  cubemap: GPUTextureView
  volume: GPUTextureView
  sampler: GPUSampler
}

/** The sampler the cubemap and the volume are read through: linear, clamped, the one of the device. */
export const createFogSampler = oncePerDevice((device: GPUDevice) =>
  device.createSampler({
    label: 'Trillion3D fog',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  }),
)

/**
 * What a program that reads the fog is bound to where the scene has no cubemap and builds no
 * volume: a white cubemap, one empty cell of volume — the view block says no volume is built, its
 * read answers none (`fogVolumeBuilt`) — and the sampler. Made when the first program asks for it
 * (`DeferredPlaceholders.fog`), handed to every program that reads the fog.
 */
export function createFogStandIns(device: GPUDevice) {
  const white = createWhiteCubemap(device)
  const empty = standInTexture(device, 'Trillion3D fog no volume', FOG_VOLUME_FORMAT, {
    dimension: '3d',
  })
  const read: FogRead = {
    cubemap: white.view,
    volume: empty.createView(),
    sampler: createFogSampler(device),
  }
  return {
    read,
    destroy() {
      white.destroy()
      empty.destroy()
    },
  }
}

/** The layout entries of a program that reads the fog's cubemap and volume as `b` binds them
 *  (`fogResourcesWgsl`), seen by `visibility`: what a lighting program adds to its own layout so the
 *  fog's read runs in it. The cubemap is a filterable cube, the volume a filterable 3D texture. */
export function fogReadLayoutEntries(
  b: FogResourceBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] {
  const entries: GPUBindGroupLayoutEntry[] = []
  if (b.sampler !== undefined) entries.push(computeSamplerEntry(b.sampler, 'filtering', visibility))
  if (b.cubemap !== undefined)
    entries.push(computeTextureEntry(b.cubemap, 'float', 'cube', visibility))
  if (b.volume !== undefined) entries.push(computeTextureEntry(b.volume, 'float', '3d', visibility))
  return entries
}

/** The bind group entries of a program that binds `read` as `b` (`fogReadLayoutEntries`). */
export function fogReadBindEntries(b: FogResourceBindings, read: FogRead): GPUBindGroupEntry[] {
  const entries: GPUBindGroupEntry[] = []
  if (b.sampler !== undefined) entries.push({ binding: b.sampler, resource: read.sampler })
  if (b.cubemap !== undefined) entries.push({ binding: b.cubemap, resource: read.cubemap })
  if (b.volume !== undefined) entries.push({ binding: b.volume, resource: read.volume })
  return entries
}
