import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { standInBuffer, standInTexture } from '../../gpu/core/standIns.ts'
import { createWhiteCubemap } from './cubemapGpu.ts'
import type { FogResourceBindings } from './readWgsl.ts'

/** The format of the volumes: four half floats a cell. */
export const FOG_VOLUME_FORMAT: GPUTextureFormat = 'rgba16float'

/** What a program that reads the fog is bound to, past the light buffer: the cubemap, the integrated
 *  volume, the sampler both are read through, and the lists of the local fog volumes over each tile
 *  (`fogResourcesWgsl`). A new object where one of the views or the lists' buffer changed, so that a
 *  program that keeps its group compares the object. */
export interface FogRead {
  cubemap: GPUTextureView
  volume: GPUTextureView
  sampler: GPUSampler
  tiles: GPUBuffer
}

/**
 * What a program that reads the fog is bound to where the scene has no cubemap and builds no
 * volume: a white cubemap, one empty cell of volume — the view block says no volume is built, its
 * read answers none (`fogVolumeBuilt`) — the sampler, and one word of lists of local fog volumes,
 * which the view's tiling is checked against and found too small (`localFogTiled`). Made when the
 * first program asks for it (`DeferredPlaceholders.fog`), handed to every program that reads the fog.
 */
export function createFogStandIns(device: GPUDevice) {
  const white = createWhiteCubemap(device)
  const empty = standInTexture(device, 'Trillion3D fog no volume', FOG_VOLUME_FORMAT, {
    dimension: '3d',
  })
  const tiles = standInBuffer(device, 'Trillion3D fog no local volumes', 16, GPUBufferUsage.STORAGE)
  const read: FogRead = {
    cubemap: white.view,
    volume: empty.createView(),
    sampler: postSamplers(device).mipped,
    tiles,
  }
  return {
    read,
    destroy() {
      white.destroy()
      empty.destroy()
      tiles.destroy()
    },
  }
}

/** The layout entries of a program that reads the fog's cubemap, volume and local fog volumes' lists as
 *  `b` binds them (`fogResourcesWgsl`), seen by `visibility`: what a lighting program adds to its own
 *  layout so the fog's read runs in it. The cubemap is a filterable cube, the volume a filterable 3D
 *  texture, the lists a read-only storage buffer. */
export function fogReadLayoutEntries(
  b: FogResourceBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] {
  const entries: GPUBindGroupLayoutEntry[] = []
  if (b.sampler !== undefined) entries.push(computeSamplerEntry(b.sampler, 'filtering', visibility))
  if (b.cubemap !== undefined)
    entries.push(computeTextureEntry(b.cubemap, 'float', 'cube', visibility))
  if (b.volume !== undefined) entries.push(computeTextureEntry(b.volume, 'float', '3d', visibility))
  if (b.lightShaft !== undefined)
    entries.push(computeTextureEntry(b.lightShaft, 'float', '2d', visibility))
  if (b.tiles !== undefined)
    entries.push(computeBufferEntry(b.tiles, 'read-only-storage', visibility))
  return entries
}

/** The bind group entries of a program that binds `read` as `b` (`fogReadLayoutEntries`), with the
 *  light shafts' occlusion mask `lightShaft` where it binds one. */
export function fogReadBindEntries(
  b: FogResourceBindings,
  read: FogRead,
  lightShaft?: GPUTextureView,
): GPUBindGroupEntry[] {
  const entries: GPUBindGroupEntry[] = []
  if (b.sampler !== undefined) entries.push({ binding: b.sampler, resource: read.sampler })
  if (b.cubemap !== undefined) entries.push({ binding: b.cubemap, resource: read.cubemap })
  if (b.volume !== undefined) entries.push({ binding: b.volume, resource: read.volume })
  if (b.lightShaft !== undefined && lightShaft)
    entries.push({ binding: b.lightShaft, resource: lightShaft })
  if (b.tiles !== undefined) entries.push({ binding: b.tiles, resource: { buffer: read.tiles } })
  return entries
}
